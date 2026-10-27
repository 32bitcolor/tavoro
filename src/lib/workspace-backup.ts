import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { getObjectBytes, putObjectBytes, buildObjectKey, buildReviewObjectKey } from "@/lib/storage";
import { workspaceStatusSeedData } from "@/lib/status";
import { newGuestNonce } from "@/lib/review-guest-token";

// Full logical backup of a single workspace: the entire content graph plus its
// members (by email) and attachment media. Restore recreates it as a NEW
// workspace with freshly-generated ids (every foreign key remapped), so a backup
// can be restored into the same instance (a copy) or a fresh one (disaster
// recovery). Media re-uploads to object storage under new keys.

export const BACKUP_FORMAT = 12; // bump when the shape changes

const WS = "__ws";
const USER = "__user";

type Spec = {
  key: string | null; // entity id-map key; null = junction table (no own id)
  model: string; // prisma delegate name
  where: (wsId: string) => any; // export filter scoping the table to the workspace
  fks: Record<string, string>; // column -> map key (an entity key, WS, or USER)
  sort?: (rows: any[]) => any[]; // reorder before import, for self-referential fks
  json?: string[]; // nullable Json columns — Prisma wants DbNull, not null, on create
  omit?: string[]; // columns never written to a backup file (credentials)
  fill?: () => Record<string, any>; // replacement values for omitted columns on import
  // Last word on a row before it's created (e.g. re-upload its bytes under a new key).
  // Return false to skip the row.
  prepare?: (d: any, row: any, media: Record<string, Uint8Array>) => Promise<boolean>;
};

// A card's column is null when it's a subtask — reach it via its parent's
// column instead, same one-hop pattern as getCardForUser in authz.ts.
function cardInWorkspace(w: string): any {
  return {
    OR: [
      { column: { board: { workspaceId: w } } },
      { parentCard: { column: { board: { workspaceId: w } } } },
    ],
  };
}

// Ordered by foreign-key dependency so parents exist before children on restore.
const SPECS: Spec[] = [
  { key: "group", model: "group", where: (w) => ({ workspaceId: w }), fks: { workspaceId: WS } },
  { key: "workspaceStatus", model: "workspaceStatus", where: (w) => ({ workspaceId: w }), fks: { workspaceId: WS } },
  // Project before Board so Board.projectId can remap on import; both before
  // Column/Card so their statusId → workspaceStatus remaps too.
  { key: "project", model: "project", where: (w) => ({ workspaceId: w }), fks: { workspaceId: WS } },
  // A restored board starts unshared: its public link (if any) belongs to the original.
  {
    key: "board",
    model: "board",
    where: (w) => ({ workspaceId: w }),
    fks: { workspaceId: WS, projectId: "project" },
    omit: ["publicNonce", "publicSharedAt", "publicSharedById"],
  },
  // Intake requests (after Project, for convertedProjectId). Numbers are per workspace,
  // so a restored copy keeps its REQ-n tickets.
  {
    key: "intakeRequest",
    model: "intakeRequest",
    where: (w) => ({ workspaceId: w }),
    fks: { workspaceId: WS, convertedProjectId: "project", requestedById: USER, assignedToId: USER, decidedById: USER },
    // Formats 9–10 kept the last question on the request; it's a conversation message now.
    // The restored copy gets a fresh status link either way (the id changes).
    prepare: async (d) => {
      delete d.infoQuestion;
      delete d.infoRequestedAt;
      delete d.statusNonce;
      return true;
    },
  },
  { key: "intakeMessage", model: "intakeMessage", where: (w) => ({ request: { workspaceId: w } }), fks: { requestId: "intakeRequest", authorId: USER } },
  { key: "column", model: "column", where: (w) => ({ board: { workspaceId: w } }), fks: { boardId: "board", statusId: "workspaceStatus" } },
  // A subtask is a Card with columnId null and parentCardId set — the OR clause
  // pulls both top-level cards (via their column) and subtask-cards (via their
  // parent's column) into the same export bucket. On import, self-referential
  // parentCardId can only remap once the parent row already exists, so `sort`
  // puts top-level cards (parentCardId null) before subtask-cards.
  {
    key: "card",
    model: "card",
    where: cardInWorkspace,
    fks: { columnId: "column", parentCardId: "card", statusId: "workspaceStatus" },
    sort: (rows) => [...rows].sort((a, b) => (a.parentCardId ? 1 : 0) - (b.parentCardId ? 1 : 0)),
  },
  { key: "label", model: "label", where: (w) => ({ workspaceId: w }), fks: { workspaceId: WS } },
  { key: "phase", model: "phase", where: (w) => ({ project: { workspaceId: w } }), fks: { projectId: "project" } },
  { key: "deliverable", model: "deliverable", where: (w) => ({ project: { workspaceId: w } }), fks: { projectId: "project", phaseId: "phase", cardId: "card" } },
  { key: "milestone", model: "milestone", where: (w) => ({ project: { workspaceId: w } }), fks: { projectId: "project" } },
  { key: "learningObjective", model: "learningObjective", where: (w) => ({ project: { workspaceId: w } }), fks: { projectId: "project" } },
  { key: "assessmentItem", model: "assessmentItem", where: (w) => ({ project: { workspaceId: w } }), fks: { projectId: "project" } },
  { key: "storyboard", model: "storyboard", where: (w) => ({ workspaceId: w }), fks: { workspaceId: WS, deliverableId: "deliverable" } },
  { key: "screen", model: "screen", where: (w) => ({ storyboard: { workspaceId: w } }), fks: { storyboardId: "storyboard" } },
  { key: "whiteboard", model: "whiteboard", where: (w) => ({ workspaceId: w }), fks: { workspaceId: WS, storyboardId: "storyboard", cardId: "card", createdById: USER } },
  // A round's snapshot and its comments' anchors refer to screens by their ORIGINAL
  // ids. Both travel inside the backup and only point at each other (never at live
  // Screen rows), so they stay consistent after a restore without remapping.
  // Files under review travel with their bytes (in the zip's media/, keyed by row id,
  // like attachments) and are re-uploaded under the new workspace's keys.
  {
    key: "reviewFile",
    model: "reviewFile",
    where: (w) => ({ workspaceId: w }),
    fks: { workspaceId: WS, deliverableId: "deliverable", uploadedById: USER },
    prepare: async (d, row, media) => {
      const bytes = media[row.id];
      if (!bytes || !d.deliverableId) return false;
      d.storageKey = buildReviewObjectKey(d.workspaceId, d.deliverableId, d.fileName);
      await putObjectBytes(d.storageKey, bytes, d.mimeType);
      return true;
    },
  },
  {
    key: "reviewRound",
    model: "reviewRound",
    where: (w) => ({ deliverable: { project: { workspaceId: w } } }),
    fks: { deliverableId: "deliverable", createdById: USER, overriddenById: USER, fileId: "reviewFile" },
    json: ["snapshot"],
  },
  // Guest reviewers travel without their link nonce, and get a fresh one on restore:
  // a restored workspace has dead guest links by design, so a backup file can never be
  // used to open someone's review (docs/REVIEW-LINKS.md). Members re-send links.
  {
    key: "reviewGuest",
    model: "reviewGuest",
    where: (w) => ({
      OR: [
        { assignment: { deliverable: { project: { workspaceId: w } } } },
        { comments: { some: { round: { deliverable: { project: { workspaceId: w } } } } } },
      ],
    }),
    fks: {},
    omit: ["nonce"],
    fill: () => ({ nonce: newGuestNonce() }),
  },
  { key: "reviewCycle", model: "reviewCycle", where: (w) => ({ deliverable: { project: { workspaceId: w } } }), fks: { deliverableId: "deliverable", roundId: "reviewRound", reviewerId: USER, guestId: "reviewGuest", requestedById: USER } },
  {
    key: "reviewComment",
    model: "reviewComment",
    where: (w) => ({ round: { deliverable: { project: { workspaceId: w } } } }),
    fks: { roundId: "reviewRound", parentId: "reviewComment", authorId: USER, guestId: "reviewGuest", resolvedById: USER, cardId: "card" },
    json: ["anchor"],
    sort: (rows) => [...rows].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0)),
  },
  { key: "timeEntry", model: "timeEntry", where: (w) => ({ project: { workspaceId: w } }), fks: { projectId: "project", deliverableId: "deliverable", userId: USER } },
  { key: "comment", model: "comment", where: (w) => ({ card: cardInWorkspace(w) }), fks: { cardId: "card", authorId: USER } },
  // junctions
  // Keys cards had on boards they were moved off (see moveCardToBoard).
  { key: null, model: "cardKeyAlias", where: (w) => ({ board: { workspaceId: w } }), fks: { boardId: "board", cardId: "card" } },
  { key: null, model: "cardLabel", where: (w) => ({ card: cardInWorkspace(w) }), fks: { cardId: "card", labelId: "label" } },
  { key: null, model: "cardAssignee", where: (w) => ({ card: cardInWorkspace(w) }), fks: { cardId: "card", userId: USER } },
  { key: null, model: "cardSme", where: (w) => ({ card: cardInWorkspace(w) }), fks: { cardId: "card", userId: USER } },
  { key: null, model: "boardGroup", where: (w) => ({ board: { workspaceId: w } }), fks: { boardId: "board", groupId: "group" } },
  { key: null, model: "projectGroup", where: (w) => ({ project: { workspaceId: w } }), fks: { projectId: "project", groupId: "group" } },
  { key: null, model: "storyboardGroup", where: (w) => ({ storyboard: { workspaceId: w } }), fks: { storyboardId: "storyboard", groupId: "group" } },
  { key: null, model: "whiteboardGroup", where: (w) => ({ whiteboard: { workspaceId: w } }), fks: { whiteboardId: "whiteboard", groupId: "group" } },
  { key: null, model: "screenObjective", where: (w) => ({ objective: { project: { workspaceId: w } } }), fks: { screenId: "screen", objectiveId: "learningObjective" } },
  { key: null, model: "assessmentItemObjective", where: (w) => ({ objective: { project: { workspaceId: w } } }), fks: { itemId: "assessmentItem", objectiveId: "learningObjective" } },
  { key: null, model: "groupMembership", where: (w) => ({ group: { workspaceId: w } }), fks: { groupId: "group", userId: USER } },
];

export type WorkspaceExport = {
  format: number;
  exportedAt: string;
  workspace: { name: string; slug: string };
  users: { id: string; email: string; name: string | null }[];
  members: { email: string; role: string }[];
  data: Record<string, any[]>;
  // attachment media is stored alongside in the zip, keyed by attachment id
};

function slugify(input: string): string {
  return (
    input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace"
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function exportWorkspace(workspaceId: string): Promise<{
  json: WorkspaceExport;
  media: Record<string, Uint8Array>;
}> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true, slug: true },
  });
  const memberships = await prisma.membership.findMany({
    where: { workspaceId },
    select: { role: true, user: { select: { id: true, email: true, name: true } } },
  });

  const data: Record<string, any[]> = {};
  for (const spec of SPECS) {
    const rows = await (prisma as any)[spec.model].findMany({ where: spec.where(workspaceId) });
    for (const row of rows) for (const col of spec.omit ?? []) delete row[col];
    data[spec.model] = spec.sort ? spec.sort(rows) : rows;
  }
  const attachments = await prisma.attachment.findMany({ where: { workspaceId } });
  data.attachment = attachments;

  // media bytes for each attachment and review file (best-effort — a missing object
  // is skipped). Ids are cuids, unique across both tables.
  const media: Record<string, Uint8Array> = {};
  for (const a of [...attachments, ...(data.reviewFile ?? [])]) {
    const bytes = await getObjectBytes(a.storageKey);
    if (bytes) media[a.id] = bytes;
  }

  return {
    json: {
      format: BACKUP_FORMAT,
      exportedAt: new Date().toISOString(),
      workspace: { name: workspace.name, slug: workspace.slug },
      users: memberships.map((m) => ({ id: m.user.id, email: m.user.email, name: m.user.name })),
      members: memberships.map((m) => ({ email: m.user.email, role: m.role })),
      data,
      // attachment rows live in data.attachment; bytes in media
    } as WorkspaceExport,
    media,
  };
}

// ── Import ────────────────────────────────────────────────────────────────────

const NO_LOGIN_HASH = "!restored:no-login"; // invalid argon2 → login always fails until reset

/** Backups at format ≤3 carry board-scoped labels: a `boardId` column, no
 *  `workspaceId`, and possibly several same-named labels across different boards.
 *  Fold them into the workspace-level shape the schema now expects — same merge rule
 *  as the workspace_level_labels migration (most-used wins, tie-broken by id) — so
 *  the generic import loop below sees only format-4 data. */
function upgradeLegacyLabels(exp: WorkspaceExport): void {
  if ((exp.format ?? 0) >= 4) return;
  const labels: any[] = exp.data.label ?? [];
  if (!labels.length) return;

  const uses = new Map<string, number>();
  for (const cl of (exp.data.cardLabel ?? []) as any[]) {
    uses.set(cl.labelId, (uses.get(cl.labelId) ?? 0) + 1);
  }

  const keptByName = new Map<string, any>();
  const remap: Record<string, string> = {};
  const ranked = [...labels].sort(
    (a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || (a.id < b.id ? -1 : 1),
  );
  for (const l of ranked) {
    const key = String(l.name ?? "").toLowerCase();
    const kept = keptByName.get(key);
    if (kept) {
      remap[l.id] = kept.id;
      continue;
    }
    keptByName.set(key, l);
    remap[l.id] = l.id;
  }

  exp.data.label = [...keptByName.values()].map((l) => {
    const row = { ...l };
    delete row.boardId; // no such column any more; workspaceId is filled by the WS remap
    return row;
  });

  // A merge can collapse two of a card's labels into one link — dedupe, since
  // (cardId, labelId) is the primary key.
  const seen = new Set<string>();
  exp.data.cardLabel = ((exp.data.cardLabel ?? []) as any[]).flatMap((cl) => {
    const labelId = remap[cl.labelId];
    if (!labelId) return [];
    const key = `${cl.cardId}\u0000${labelId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...cl, labelId }];
  });
}

/** Backups at format ≤4 predate review rounds: each ReviewCycle was its own round.
 *  Synthesize one ReviewRound per (deliverable, round number) — the same rule as the
 *  review_rounds migration — and point the cycles at them. Legacy rounds carry no
 *  snapshot, since what was reviewed back then wasn't recorded. */
function upgradeLegacyReviews(exp: WorkspaceExport): void {
  if ((exp.format ?? 0) >= 5) return;
  const cycles: any[] = exp.data.reviewCycle ?? [];
  const withStoryboard = new Set(((exp.data.storyboard ?? []) as any[]).map((sb) => sb.deliverableId).filter(Boolean));
  const rounds = new Map<string, any>();
  for (const c of [...cycles].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    const key = `${c.deliverableId} ${c.round}`;
    const decided = c.status === "approved" || c.status === "changes_requested";
    if (!rounds.has(key)) {
      rounds.set(key, {
        id: `legacy-round-${c.id}`,
        deliverableId: c.deliverableId,
        number: c.round,
        targetKind: withStoryboard.has(c.deliverableId) ? "storyboard" : "none",
        snapshot: null,
        dueDate: c.dueDate ?? null,
        createdById: c.requestedById ?? null,
        createdAt: c.createdAt,
        outcome: c.status === "approved" ? "passed" : c.status === "changes_requested" ? "changes_requested" : null,
        closedAt: decided ? c.updatedAt ?? null : null,
        overriddenById: null,
        overriddenAt: null,
        overrideReason: null,
      });
    }
    c.roundId = rounds.get(key).id;
    c.decidedAt = decided ? c.updatedAt ?? null : null;
  }
  exp.data.reviewRound = [...rounds.values()];
  exp.data.reviewComment = [];
}

export async function importWorkspace(
  exp: WorkspaceExport,
  media: Record<string, Uint8Array>,
  importerUserId: string,
): Promise<{ workspaceId: string; name: string }> {
  upgradeLegacyLabels(exp);
  upgradeLegacyReviews(exp);

  // 1. new workspace with a unique slug
  const name = `${exp.workspace.name} (restored)`;
  const slug = `${slugify(exp.workspace.name)}-${Math.abs(hashStr(exp.exportedAt + name)) % 100000}`;
  const ws = await prisma.workspace.create({ data: { name, slug } });
  try {
    await fillWorkspace(ws.id, exp, media, importerUserId);
  } catch (err) {
    // Don't leave a half-restored copy behind.
    await prisma.workspace.delete({ where: { id: ws.id } }).catch(() => {});
    throw err;
  }
  return { workspaceId: ws.id, name };
}

async function fillWorkspace(
  wsId: string,
  exp: WorkspaceExport,
  media: Record<string, Uint8Array>,
  importerUserId: string,
): Promise<void> {
  const ws = { id: wsId };
  const maps: Record<string, Record<string, string>> = {};
  const userMap: Record<string, string> = {}; // old userId -> new userId
  const emailToUser: Record<string, string> = {};

  // 2. users (find-or-create by email) + memberships
  for (const u of exp.users) {
    let user = await prisma.user.findUnique({ where: { email: u.email }, select: { id: true } });
    if (!user) {
      user = await prisma.user.create({
        data: { email: u.email, name: u.name, passwordHash: NO_LOGIN_HASH },
        select: { id: true },
      });
    }
    userMap[u.id] = user.id;
    emailToUser[u.email] = user.id;
  }
  for (const m of exp.members) {
    const uid = emailToUser[m.email];
    if (!uid) continue;
    const role = m.role === "ADMIN" || m.role === "MANAGER" ? m.role : "MEMBER";
    await prisma.membership.create({
      data: { userId: uid, workspaceId: ws.id, role },
    });
  }
  // ensure the importer can reach the restored workspace as an admin
  const importerHasMembership = await prisma.membership.findFirst({
    where: { userId: importerUserId, workspaceId: ws.id },
    select: { id: true },
  });
  if (!importerHasMembership) {
    await prisma.membership.create({ data: { userId: importerUserId, workspaceId: ws.id, role: "ADMIN" } });
  }

  const remap = (target: string, val: string | null): string | null => {
    if (val == null) return null;
    if (target === WS) return ws.id;
    if (target === USER) return userMap[val] ?? importerUserId;
    return maps[target]?.[val] ?? null;
  };

  // 3. content graph, in dependency order
  for (const spec of SPECS) {
    if (spec.key) maps[spec.key] = {};
    const rows = spec.sort ? spec.sort(exp.data[spec.model] ?? []) : (exp.data[spec.model] ?? []);
    for (const row of rows) {
      const d = safeRow(row, spec);
      for (const col of Object.keys(spec.fks)) d[col] = remap(spec.fks[col], row[col] ?? null);
      for (const col of spec.json ?? []) if (d[col] == null) d[col] = Prisma.DbNull;
      if (spec.fill) Object.assign(d, spec.fill());
      if (spec.prepare && !(await spec.prepare(d, row, media))) continue;
      const created = await (prisma as any)[spec.model].create({ data: d });
      if (spec.key) maps[spec.key][row.id] = created.id;
    }
  }

  // Backups taken before the canonical-status migration carry no
  // workspaceStatus rows; seed defaults so the restored workspace is usable.
  if (!(exp.data.workspaceStatus?.length)) {
    await prisma.workspaceStatus.createMany({ data: workspaceStatusSeedData(ws.id) });
  }

  // 4. attachments + media (needs remapped cardId + a fresh storage key)
  maps.attachment = {};
  for (const a of exp.data.attachment ?? []) {
    const newCardId = maps.card?.[a.cardId];
    if (!newCardId) continue;
    const key = buildObjectKey(ws.id, newCardId, a.fileName);
    const bytes = media[a.id];
    if (bytes) await putObjectBytes(key, bytes, a.mimeType || "application/octet-stream");
    const created = await prisma.attachment.create({
      data: {
        cardId: newCardId,
        workspaceId: ws.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        storageKey: key,
        uploadedById: userMap[a.uploadedById] ?? importerUserId,
      },
      select: { id: true },
    });
    maps.attachment[a.id] = created.id;
  }
}

const isPrimitive = (v: unknown) => v === null || v instanceof Date || ["string", "number", "boolean"].includes(typeof v);

/** A backup row reduced to plain column values. The file is uploaded, so it is not
 *  trusted: an object value would be a Prisma nested write (e.g. "create a user with
 *  this password and make them admin of some other workspace"), and a foreign key the
 *  spec doesn't remap would point at another workspace's rows. Only declared Json
 *  columns may hold objects; every other "…Id" column is dropped unless remapped
 *  (in these tables every column ending in Id is a foreign key — Card.sprintId, say,
 *  as sprints aren't part of a backup). */
function safeRow(row: Record<string, unknown>, spec: Spec): Record<string, any> {
  const d: Record<string, any> = {};
  for (const [col, v] of Object.entries(row)) {
    if (col === "id" || col === "updatedAt") continue; // fresh id; let @updatedAt default
    if (col.endsWith("Id") && !(col in spec.fks)) continue;
    const plain = isPrimitive(v) || (Array.isArray(v) && v.every(isPrimitive));
    if (plain || spec.json?.includes(col)) d[col] = v;
  }
  return d;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
