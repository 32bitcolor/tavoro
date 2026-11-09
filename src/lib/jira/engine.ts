// The Jira import itself, run on the worker (docs/JIRA-PARITY.md, phase 5):
//   scanImport  — the dry run: counts, and a proposed mapping;
//   runImport   — boards, statuses, cards, subtasks, comments, attachments, watchers,
//                 sprints, then epics and links once every card exists, then rank.
// Both page through Jira, save where they are after every page (so a worker restart
// resumes), and stop if the run is cancelled. Nothing here emails anyone.
//
// Re-runs: ImportedCard.snapshot holds what the last run wrote to each field. A field
// is updated only if Tavoro still has that value; otherwise someone changed it here and
// it's left alone (counted as "kept"). Comments and attachments already imported are
// skipped by their Jira ids. Nothing is ever deleted.
//
// Relative imports and no "server-only": the worker (plain tsx) runs this.
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { orientLink } from "../card-links";
import { open as openSecret } from "../secret-box";
import { adfToTipTap, plainToTipTap, type TipTapNode } from "./adf";
import { JiraClient, JiraError, type JiraIssue, type JiraSprint, type JiraUser } from "./client";
import {
  MAX_IMPORT_ATTACHMENT_BYTES,
  NOT_IMPORTED,
  defaultType,
  emptyReport,
  findFields,
  issueNumber,
  latestSprint,
  linkChoice,
  numberFields,
  parseSprints,
  priorityOf,
  sprintStatus,
  statusCategory,
  type ImportMapping,
  type ImportProject,
  type ImportReport,
  type ScanResult,
  type StatusCategory,
  type TavoroType,
} from "./map";

export type Deps = {
  prisma: PrismaClient;
  /** Store a file's bytes under a key (S3 / MinIO). */
  putObject: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  appUrl?: string;
};

type Progress = { phase: "scan" | "import" | "relations" | "rank"; projectIndex: number; pass: 1 | 2; pageToken: string | null; seen: number; total: number | null };

export class Cancelled extends Error {}

const LABEL_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#ca8a04", "#4b5563"];

function objectKey(workspaceId: string, cardId: string, fileName: string) {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
  return `workspace/${workspaceId}/card/${cardId}/${crypto.randomUUID()}-${safe}`;
}

async function loadRun(deps: Deps, importId: string) {
  const run = await deps.prisma.jiraImport.findUnique({ where: { id: importId } });
  if (!run) throw new JiraError("Import not found.");
  if (!run.tokenCipher) throw new JiraError("The API token is gone (the run ended). Start a new import.");
  const client = JiraClient.fromSite(run.site, run.email, openSecret(run.tokenCipher));
  return { run, client };
}

async function checkCancelled(deps: Deps, importId: string) {
  const r = await deps.prisma.jiraImport.findUnique({ where: { id: importId }, select: { status: true } });
  if (!r || r.status === "cancelled") throw new Cancelled();
}

const jqlFor = (key: string, pass?: 1 | 2) =>
  `project = "${key.replace(/"/g, "")}"${pass === 1 ? " AND issuetype not in subTaskIssueTypes()" : pass === 2 ? " AND issuetype in subTaskIssueTypes()" : ""} ORDER BY key ASC`;

// ── Scan (dry run) ───────────────────────────────────────────────────────────

export async function scanImport(deps: Deps, importId: string) {
  const { run, client } = await loadRun(deps, importId);
  const db = deps.prisma;
  const projects = run.projects as unknown as ImportProject[];
  const allFields = await client.fields();
  const fields = findFields(allFields);

  const statuses = new Map<string, { name: string; category: StatusCategory }>();
  const types = new Map<string, { name: string; subtask: boolean; level?: number }>();
  const users = new Map<string, JiraUser>();
  const sprints = new Set<number>();
  const labels = new Set<string>();
  const otherLinks = new Set<string>();
  const result: ScanResult = {
    at: new Date().toISOString(),
    projects: [],
    issues: 0,
    comments: 0,
    attachments: 0,
    attachmentBytes: 0,
    attachmentsTooBig: 0,
    sprints: 0,
    links: 0,
    labels: 0,
    otherLinkTypes: [],
    notImported: NOT_IMPORTED,
    numberFields: numberFields(allFields),
  };
  const see = (u: JiraUser | null | undefined) => u?.accountId && users.set(u.accountId, u);

  for (const [pi, p] of projects.entries()) {
    for (const t of await client.projectStatuses(p.key)) {
      types.set(t.name.toLowerCase(), { name: t.name, subtask: t.subtask });
      for (const s of t.statuses) statuses.set(s.id, { name: s.name, category: statusCategory(s.statusCategory?.key) });
    }
    const total = await client.approximateCount(jqlFor(p.key));
    const tally = { key: p.key, issues: 0, subtasks: 0, epics: 0 };
    const want = ["summary", "issuetype", "status", "assignee", "reporter", "comment", "attachment", "issuelinks", "labels", "components", "fixVersions", ...(fields.sprint ? [fields.sprint] : [])];
    let token: string | null = null;
    for (;;) {
      const page = await client.search(jqlFor(p.key), want, token);
      for (const i of page.issues) {
        const f = i.fields;
        tally.issues++;
        if (f.issuetype?.subtask) tally.subtasks++;
        if (f.issuetype && defaultType(f.issuetype.name, f.issuetype.subtask, f.issuetype.hierarchyLevel) === "epic") tally.epics++;
        if (f.issuetype) types.set(f.issuetype.name.toLowerCase(), { name: f.issuetype.name, subtask: f.issuetype.subtask, level: f.issuetype.hierarchyLevel });
        if (f.status) statuses.set(f.status.id, { name: f.status.name, category: statusCategory(f.status.statusCategory?.key) });
        see(f.assignee);
        see(f.reporter);
        for (const c of f.comment?.comments ?? []) see(c.author);
        result.comments += f.comment?.total ?? f.comment?.comments.length ?? 0;
        for (const a of f.attachment ?? []) {
          result.attachments++;
          result.attachmentBytes += a.size ?? 0;
          if ((a.size ?? 0) > MAX_IMPORT_ATTACHMENT_BYTES) result.attachmentsTooBig++;
        }
        for (const l of f.issuelinks ?? []) {
          // Each link shows on both issues; count it from the outward side.
          if (l.outwardIssue) result.links++;
          const c = linkChoice(l);
          if (c && !c.known) otherLinks.add(l.type.name);
        }
        for (const l of f.labels ?? []) labels.add(l.toLowerCase());
        for (const c of f.components ?? []) labels.add(`component: ${c.name}`.toLowerCase());
        for (const v of f.fixVersions ?? []) labels.add(`version: ${v.name}`.toLowerCase());
        if (fields.sprint) for (const s of parseSprints(f[fields.sprint])) sprints.add(s.id);
      }
      result.issues += page.issues.length;
      await checkCancelled(deps, importId);
      await db.jiraImport.update({
        where: { id: importId },
        data: { progress: { phase: "scan", projectIndex: pi, pass: 1, pageToken: null, seen: tally.issues, total } satisfies Progress },
      });
      token = page.nextPageToken ?? null;
      if (!token || page.isLast || page.issues.length === 0) break;
    }
    result.projects.push(tally);
  }
  result.sprints = sprints.size;
  result.labels = labels.size;
  result.otherLinkTypes = [...otherLinks].sort();

  // The proposed mapping. A re-scan keeps choices the admin already made.
  const prev = (run.mapping as ImportMapping | null) ?? null;
  const [wsStatuses, members] = await Promise.all([
    db.workspaceStatus.findMany({ where: { workspaceId: run.workspaceId }, select: { id: true, name: true } }),
    db.membership.findMany({ where: { workspaceId: run.workspaceId, suspendedAt: null }, select: { user: { select: { id: true, name: true, email: true } } } }),
  ]);
  const byName = new Map(wsStatuses.map((s) => [s.name.toLowerCase(), s.id]));
  const byEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m.user.id]));
  const nameCounts = new Map<string, string[]>();
  for (const m of members) if (m.user.name) nameCounts.set(m.user.name.toLowerCase(), [...(nameCounts.get(m.user.name.toLowerCase()) ?? []), m.user.id]);

  const mapping: ImportMapping = {
    statuses: [...statuses.entries()]
      .map(([jiraId, s]) => {
        const kept = prev?.statuses.find((x) => x.jiraId === jiraId);
        return kept ?? { jiraId, jiraName: s.name, category: s.category, statusId: byName.get(s.name.toLowerCase()) ?? null };
      })
      .sort((a, b) => ORDER[a.category] - ORDER[b.category] || a.jiraName.localeCompare(b.jiraName)),
    users: [...users.values()]
      .map((u) => {
        const kept = prev?.users.find((x) => x.accountId === u.accountId);
        if (kept) return kept;
        const email = u.emailAddress?.toLowerCase() ?? null;
        const byE = email ? byEmail.get(email) : undefined;
        const byN = nameCounts.get(u.displayName.toLowerCase());
        const memberId = byE ?? (byN?.length === 1 ? byN[0] : null);
        return { accountId: u.accountId, displayName: u.displayName, email, memberId, how: byE ? ("email" as const) : memberId ? ("name" as const) : null };
      })
      .sort((a, b) => Number(!!a.memberId) - Number(!!b.memberId) || a.displayName.localeCompare(b.displayName)),
    types: [...types.values()]
      .map((t) => {
        const kept = prev?.types.find((x) => x.jiraName.toLowerCase() === t.name.toLowerCase());
        return kept ?? { jiraName: t.name, subtask: t.subtask, to: defaultType(t.name, t.subtask, t.level) };
      })
      .sort((a, b) => a.jiraName.localeCompare(b.jiraName)),
    fields: prev?.fields ?? fields,
    componentsAsLabels: prev?.componentsAsLabels ?? true,
  };

  await db.jiraImport.update({
    where: { id: importId },
    // The project list from step 1 rides along in `scan.available`.
    data: { status: "ready", scan: { ...result, available: (run.scan as { available?: unknown } | null)?.available ?? [] } as unknown as Prisma.InputJsonValue, mapping: mapping as unknown as Prisma.InputJsonValue, progress: Prisma.DbNull, error: null },
  });
  return result;
}

const ORDER: Record<StatusCategory, number> = { todo: 0, active: 1, done: 2 };

// ── Import ───────────────────────────────────────────────────────────────────

type Snapshot = {
  f?: Record<string, string>;
  rank?: string | null;
  rel?: { epic?: { id?: string; key?: string }; links?: { otherId: string; choice: string }[] };
  comments?: Record<string, string>;
  attachments?: Record<string, string>;
};

type BoardCtx = {
  id: string;
  keepKeys: boolean;
  usedSeqs: Set<number>;
  columnByStatus: Map<string, string>;
  lastColumnPos: string | null;
};

export async function runImport(deps: Deps, importId: string) {
  const { run, client } = await loadRun(deps, importId);
  const db = deps.prisma;
  const ws = run.workspaceId;
  const projects = run.projects as unknown as ImportProject[];
  const mapping = run.mapping as unknown as ImportMapping;
  if (!mapping) throw new JiraError("Scan the projects before importing.");
  const cloudId = run.cloudId ?? (await client.cloudId());
  const report: ImportReport = (run.report as ImportReport | null) ?? emptyReport();
  let progress: Progress = (run.progress as Progress | null)?.phase === "import" || (run.progress as Progress | null)?.phase === "relations" || (run.progress as Progress | null)?.phase === "rank"
    ? (run.progress as Progress)
    : { phase: "import", projectIndex: 0, pass: 1, pageToken: null, seen: 0, total: null };

  // Whoever ran the import authors what has no matching member; fall back to an admin.
  const actorId =
    run.createdById ??
    (await db.membership.findFirst({ where: { workspaceId: ws, role: "ADMIN", suspendedAt: null }, select: { userId: true } }))?.userId;
  if (!actorId) throw new JiraError("No admin to attribute the import to.");

  const otherLinkTypes = new Set<string>();
  const linksOf = (i: JiraIssue) =>
    (i.fields.issuelinks ?? []).flatMap((l) => {
      const c = linkChoice(l);
      if (c && !c.known) otherLinkTypes.add(l.type.name);
      return c ? [{ otherId: c.otherId, choice: c.choice }] : [];
    });
  const skip = (what: string, why: string, key?: string) => {
    if (report.skipped.length < 1000) report.skipped.push({ key, what, why });
  };
  const ref = (issueId: string) => `jira:${cloudId}:${issueId}`;
  const userMap = new Map(mapping.users.filter((u) => u.memberId).map((u) => [u.accountId, u.memberId!]));
  const nameOf = new Map(mapping.users.map((u) => [u.accountId, u.displayName]));
  const typeMap = new Map(mapping.types.map((t) => [t.jiraName.toLowerCase(), t.to]));
  const fields = mapping.fields;

  // Statuses: map each Jira status to a workspace status, creating the missing ones.
  const statusMap = new Map<string, { id: string; category: StatusCategory; name: string }>();
  {
    const existing = await db.workspaceStatus.findMany({ where: { workspaceId: ws }, orderBy: { position: "asc" }, select: { id: true, name: true, category: true, position: true } });
    let last = existing.at(-1)?.position ?? null;
    for (const s of mapping.statuses) {
      let hit = s.statusId ? existing.find((e) => e.id === s.statusId) : existing.find((e) => e.name.toLowerCase() === s.jiraName.toLowerCase());
      if (!hit) {
        const position = generateKeyBetween(last, null);
        last = position;
        const created = await db.workspaceStatus.create({ data: { workspaceId: ws, name: s.jiraName.slice(0, 60), category: s.category, position }, select: { id: true, name: true, category: true, position: true } });
        existing.push(created);
        hit = created;
        report.counts.statusesCreated++;
      }
      statusMap.set(s.jiraId, { id: hit.id, category: hit.category as StatusCategory, name: hit.name });
    }
  }

  // Labels by lower-case name.
  const labels = new Map((await db.label.findMany({ where: { workspaceId: ws }, select: { id: true, name: true } })).map((l) => [l.name.toLowerCase(), l.id]));
  async function labelId(name: string) {
    const n = name.trim().slice(0, 60);
    if (!n) return null;
    const hit = labels.get(n.toLowerCase());
    if (hit) return hit;
    const created = await db.label.create({ data: { workspaceId: ws, name: n, color: LABEL_COLORS[labels.size % LABEL_COLORS.length] }, select: { id: true } }).catch(async () =>
      db.label.findFirst({ where: { workspaceId: ws, name: { equals: n, mode: "insensitive" } }, select: { id: true } }),
    );
    if (!created) return null;
    labels.set(n.toLowerCase(), created.id);
    report.counts.labelsCreated++;
    return created.id;
  }

  // Sprints by Jira id.
  const sprintIds = new Map<number, string>();
  async function sprintId(s: JiraSprint) {
    const hit = sprintIds.get(s.id);
    if (hit) return hit;
    const externalRef = `jira:${cloudId}:sprint:${s.id}`;
    const status = sprintStatus(s.state);
    const data = {
      name: s.name.slice(0, 120),
      goal: s.goal?.slice(0, 500) || null,
      status,
      startDate: s.startDate ? new Date(s.startDate) : null,
      endDate: s.endDate ? new Date(s.endDate) : null,
      completedAt: status === "completed" ? new Date(s.completeDate ?? s.endDate ?? Date.now()) : null,
    };
    const found = await db.sprint.findUnique({ where: { workspaceId_externalRef: { workspaceId: ws, externalRef } }, select: { id: true } });
    const row = found ?? (await db.sprint.create({ data: { workspaceId: ws, externalRef, ...data }, select: { id: true } }));
    if (!found) report.counts.sprints++;
    sprintIds.set(s.id, row.id);
    return row.id;
  }

  // ── Boards ──
  const boards = new Map<string, BoardCtx>();
  async function ensureBoard(p: ImportProject): Promise<BoardCtx> {
    const cached = boards.get(p.key);
    if (cached) return cached;
    let board: { id: string; name: string; cardKeyPrefix: string | null } | null = null;
    let created = false;
    if (p.target.kind === "board") {
      board = await db.board.findFirst({ where: { id: p.target.boardId, workspaceId: ws }, select: { id: true, name: true, cardKeyPrefix: true } });
      if (!board) throw new JiraError(`The board chosen for ${p.key} no longer exists.`);
    } else {
      const externalRef = `jira:${cloudId}:project:${p.id}`;
      board = await db.board.findUnique({ where: { workspaceId_externalRef: { workspaceId: ws, externalRef } }, select: { id: true, name: true, cardKeyPrefix: true } });
      if (!board) {
        const taken = await db.board.findFirst({ where: { workspaceId: ws, cardKeyPrefix: { equals: p.target.prefix, mode: "insensitive" } }, select: { id: true } });
        if (taken) throw new JiraError(`The key prefix ${p.target.prefix} is already used by another board. Pick another for ${p.key}.`);
        board = await db.board.create({ data: { workspaceId: ws, name: p.target.name.slice(0, 120), cardKeyPrefix: p.target.prefix, externalRef }, select: { id: true, name: true, cardKeyPrefix: true } });
        created = true;
        // Columns: the Jira board's layout if there is one, else one per status in use.
        const layout = await client.boardColumns(p.key);
        const wanted: { name: string; statusId: string }[] = [];
        const add = (name: string, statusId: string | undefined) => statusId && !wanted.some((w) => w.statusId === statusId) && wanted.push({ name, statusId });
        // A Tavoro column holds one status, so a Jira column with several becomes several
        // side by side: the first keeps the Jira column's name, the rest are named for their status.
        if (layout)
          for (const c of layout) {
            const mapped = c.statusIds.map((id) => statusMap.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
            mapped.forEach((m, k) => add(k === 0 ? c.name : m.name, m.id));
          }
        const projectStatuses = new Map<string, { name: string; category: StatusCategory }>();
        for (const t of await client.projectStatuses(p.key)) for (const s of t.statuses) projectStatuses.set(s.id, { name: s.name, category: statusCategory(s.statusCategory?.key) });
        [...projectStatuses.entries()]
          .sort((a, b) => ORDER[a[1].category] - ORDER[b[1].category])
          .forEach(([id]) => {
            const m = statusMap.get(id);
            if (m) add(m.name, m.id);
          });
        const keys = generateNKeysBetween(null, null, wanted.length);
        for (const [i, w] of wanted.entries()) await db.column.create({ data: { boardId: board.id, name: w.name.slice(0, 60), statusId: w.statusId, position: keys[i] } });
      }
    }
    const [cols, seqs] = await Promise.all([
      db.column.findMany({ where: { boardId: board.id }, orderBy: { position: "asc" }, select: { id: true, statusId: true, position: true } }),
      db.card.findMany({ where: { OR: [{ column: { boardId: board.id } }, { parentCard: { column: { boardId: board.id } } }], keySeq: { not: null } }, select: { keySeq: true } }),
    ]);
    const columnByStatus = new Map<string, string>();
    for (const c of cols) if (c.statusId && !columnByStatus.has(c.statusId)) columnByStatus.set(c.statusId, c.id);
    const ctx: BoardCtx = {
      id: board.id,
      keepKeys: !!board.cardKeyPrefix && board.cardKeyPrefix.toUpperCase() === p.key.toUpperCase(),
      usedSeqs: new Set(seqs.map((s) => s.keySeq!)),
      columnByStatus,
      lastColumnPos: cols.at(-1)?.position ?? null,
    };
    if (!report.boards.some((b) => b.projectKey === p.key)) report.boards.push({ projectKey: p.key, boardId: board.id, name: board.name, created });
    boards.set(p.key, ctx);
    return ctx;
  }

  async function columnFor(b: BoardCtx, status: { id: string; name: string }) {
    const hit = b.columnByStatus.get(status.id);
    if (hit) return hit;
    const position = generateKeyBetween(b.lastColumnPos, null);
    b.lastColumnPos = position;
    const col = await db.column.create({ data: { boardId: b.id, name: status.name.slice(0, 60), statusId: status.id, position }, select: { id: true } });
    b.columnByStatus.set(status.id, col.id);
    return col.id;
  }

  const lastPos = new Map<string, string | null>(); // column or parent card → last child position
  async function nextPosition(where: { columnId: string } | { parentCardId: string }) {
    const k = "columnId" in where ? `c:${where.columnId}` : `p:${where.parentCardId}`;
    if (!lastPos.has(k)) {
      const last = await db.card.findFirst({ where, orderBy: { position: "desc" }, select: { position: true } });
      lastPos.set(k, last?.position ?? null);
    }
    const pos = generateKeyBetween(lastPos.get(k)!, null);
    lastPos.set(k, pos);
    return pos;
  }

  async function keySeqFor(b: BoardCtx, issueKey: string) {
    const n = issueNumber(issueKey);
    if (b.keepKeys && n != null && !b.usedSeqs.has(n)) {
      b.usedSeqs.add(n);
      await db.$executeRaw`UPDATE "Board" SET "cardKeySeq" = GREATEST("cardKeySeq", ${n}) WHERE id = ${b.id}`;
      return n;
    }
    const row = await db.board.update({ where: { id: b.id }, data: { cardKeySeq: { increment: 1 } }, select: { cardKeySeq: true, cardKeyPrefix: true } });
    let seq = row.cardKeySeq;
    while (b.usedSeqs.has(seq)) seq = (await db.board.update({ where: { id: b.id }, data: { cardKeySeq: { increment: 1 } }, select: { cardKeySeq: true } })).cardKeySeq;
    b.usedSeqs.add(seq);
    if (row.cardKeyPrefix && `${row.cardKeyPrefix}-${seq}` !== issueKey && report.rekeyed.length < 2000) report.rekeyed.push({ jira: issueKey, tavoro: `${row.cardKeyPrefix}-${seq}` });
    return seq;
  }

  // ── One issue ──
  const attachmentNames = (i: JiraIssue) => new Map((i.fields.attachment ?? []).map((a) => [a.id, a.filename]));

  function toDoc(adf: unknown, i: JiraIssue): TipTapNode & { type: "doc" } {
    const files = attachmentNames(i);
    const opts = {
      mention: (accountId: string, label: string) => {
        const id = userMap.get(accountId);
        return id ? { id, label: nameOf.get(accountId) ?? label } : null;
      },
      media: (a: Record<string, unknown>) => `📎 ${String(a.alt ?? files.get(String(a.id)) ?? "attachment")}`,
    };
    if (typeof adf === "string") return plainToTipTap(adf) as TipTapNode & { type: "doc" };
    return adfToTipTap(adf, opts) as TipTapNode & { type: "doc" };
  }

  /** Field values as Tavoro will hold them, serialized for comparison with the snapshot. */
  function valuesFor(i: JiraIssue, subtask: boolean, sprint: string | null) {
    const f = i.fields;
    const doc = f.description ? toDoc(f.description, i) : null;
    const unmatched = f.assignee && !userMap.has(f.assignee.accountId) ? f.assignee.displayName : null;
    if (unmatched) {
      const footer: TipTapNode = { type: "paragraph", content: [{ type: "text", text: `From Jira: assigned to ${unmatched}.`, marks: [{ type: "italic" }] }] };
      const base = doc ?? { type: "doc" as const, content: [] };
      base.content = [...(base.content ?? []).filter((n) => !(n.type === "paragraph" && !n.content)), footer];
      return build(base);
    }
    return build(doc);

    function build(d: TipTapNode | null) {
      const labelNames = [...new Set([...(f.labels ?? []), ...(mapping.componentsAsLabels ? [...(f.components ?? []).map((c) => `component: ${c.name}`), ...(f.fixVersions ?? []).map((v) => `version: ${v.name}`)] : [])])];
      const points = fields.points ? f[fields.points] : null;
      const type = (typeMap.get(f.issuetype?.name.toLowerCase() ?? "") ?? defaultType(f.issuetype?.name ?? "", !!f.issuetype?.subtask, f.issuetype?.hierarchyLevel)) as TavoroType | "subtask";
      const status = f.status ? statusMap.get(f.status.id) : undefined;
      return {
        title: (f.summary ?? i.key).slice(0, 500),
        description: d ? JSON.stringify(d) : "",
        type: (subtask || type === "subtask" ? "task" : type) as string,
        priority: priorityOf(f.priority?.name) ?? "",
        estimate: typeof points === "number" && Number.isFinite(points) ? String(Math.round(points * 100) / 100) : "",
        due: f.duedate ? `${f.duedate}T17:00:00.000Z` : "",
        status: subtask ? String(status?.category === "done") : (status?.id ?? ""),
        assignees: f.assignee && userMap.has(f.assignee.accountId) ? userMap.get(f.assignee.accountId)! : "",
        labels: labelNames.map((l) => l.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)).join("\n"),
        sprint: subtask || type === "epic" ? "" : (sprint ?? ""),
      };
    }
  }
  type Values = ReturnType<typeof valuesFor>;

  async function currentValues(cardId: string, subtask: boolean): Promise<Values> {
    const c = await db.card.findUniqueOrThrow({
      where: { id: cardId },
      select: {
        title: true, description: true, type: true, priority: true, estimate: true, dueDate: true, statusId: true, done: true, sprintId: true,
        assignees: { select: { userId: true } },
        labels: { select: { label: { select: { name: true } } } },
      },
    });
    return {
      title: c.title,
      description: c.description ?? "",
      type: c.type,
      priority: c.priority ?? "",
      estimate: c.estimate == null ? "" : String(c.estimate),
      due: c.dueDate ? c.dueDate.toISOString() : "",
      status: subtask ? String(c.done) : (c.statusId ?? ""),
      assignees: c.assignees.map((a) => a.userId).sort().join("\n"),
      labels: c.labels.map((l) => l.label.name).sort((a, b) => a.localeCompare(b)).join("\n"),
      sprint: c.sprintId ?? "",
    };
  }

  async function applyValues(cardId: string, v: Partial<Values>, b: BoardCtx | null, subtask: boolean) {
    const data: Prisma.CardUncheckedUpdateInput = {};
    if (v.title !== undefined) data.title = v.title;
    if (v.description !== undefined) data.description = v.description || null;
    if (v.type !== undefined && !subtask) data.type = v.type;
    if (v.priority !== undefined) data.priority = v.priority || null;
    if (v.estimate !== undefined) data.estimate = v.estimate ? Number(v.estimate) : null;
    if (v.due !== undefined) data.dueDate = v.due ? new Date(v.due) : null;
    if (v.sprint !== undefined) data.sprintId = v.sprint || null;
    if (v.status !== undefined) {
      if (subtask) data.done = v.status === "true";
      else if (v.status && b) {
        const st = [...statusMap.values()].find((s) => s.id === v.status);
        if (st) {
          const columnId = await columnFor(b, st);
          data.statusId = st.id;
          data.columnId = columnId;
          data.position = await nextPosition({ columnId });
        }
      }
    }
    if (Object.keys(data).length) await db.card.update({ where: { id: cardId }, data });
    if (v.assignees !== undefined) {
      await db.cardAssignee.deleteMany({ where: { cardId } });
      if (v.assignees) await db.cardAssignee.create({ data: { cardId, userId: v.assignees } });
    }
    if (v.labels !== undefined) {
      await db.cardLabel.deleteMany({ where: { cardId } });
      const ids = (await Promise.all(v.labels.split("\n").filter(Boolean).map(labelId))).filter((x): x is string => !!x);
      if (ids.length) await db.cardLabel.createMany({ data: [...new Set(ids)].map((labelId) => ({ cardId, labelId })), skipDuplicates: true });
    }
  }

  async function importIssue(i: JiraIssue, p: ImportProject, b: BoardCtx, subtaskPass: boolean) {
    const f = i.fields;
    const externalRef = ref(i.id);
    const existing = await db.importedCard.findUnique({ where: { workspaceId_externalRef: { workspaceId: ws, externalRef } }, select: { cardId: true, snapshot: true } });

    // Where it goes.
    let parentCardId: string | null = null;
    if (subtaskPass) {
      const parentRef = f.parent ? ref(f.parent.id) : null;
      const parent = parentRef ? await db.importedCard.findUnique({ where: { workspaceId_externalRef: { workspaceId: ws, externalRef: parentRef } }, select: { cardId: true, card: { select: { parentCardId: true } } } }) : null;
      if (!parent || parent.card.parentCardId) {
        skip("Sub-task", "its parent issue wasn’t imported", i.key);
        return;
      }
      parentCardId = parent.cardId;
    }
    const jiraSprints = fields.sprint ? parseSprints(f[fields.sprint]) : [];
    for (const s of jiraSprints) await sprintId(s);
    const latest = latestSprint(jiraSprints);
    const v = valuesFor(i, subtaskPass, latest ? (sprintIds.get(latest.id) ?? null) : null);
    const status = f.status ? statusMap.get(f.status.id) : undefined;

    const snap: Snapshot = (existing?.snapshot as Snapshot | null) ?? {};
    let cardId: string;
    if (!existing) {
      const keySeq = await keySeqFor(b, i.key);
      const created = f.created ? new Date(f.created) : new Date();
      if (subtaskPass) {
        const card = await db.card.create({
          data: {
            parentCardId,
            title: v.title,
            description: v.description || null,
            done: v.status === "true",
            dueDate: v.due ? new Date(v.due) : null,
            priority: v.priority || null,
            estimate: v.estimate ? Number(v.estimate) : null,
            keySeq,
            position: await nextPosition({ parentCardId: parentCardId! }),
            createdAt: created,
          },
          select: { id: true },
        });
        cardId = card.id;
        report.counts.subtasks++;
      } else {
        const st = status ?? [...statusMap.values()][0];
        if (!st) {
          skip("Issue", "its status isn’t mapped", i.key);
          return;
        }
        const columnId = await columnFor(b, st);
        const card = await db.card.create({
          data: {
            columnId,
            statusId: st.id,
            title: v.title,
            description: v.description || null,
            type: v.type,
            priority: v.priority || null,
            estimate: v.estimate ? Number(v.estimate) : null,
            dueDate: v.due ? new Date(v.due) : null,
            sprintId: v.sprint || null,
            keySeq,
            position: await nextPosition({ columnId }),
            createdAt: created,
          },
          select: { id: true },
        });
        cardId = card.id;
      }
      await applyValues(cardId, { assignees: v.assignees, labels: v.labels }, b, subtaskPass);
      await db.cardActivity.create({
        data: { cardId, actorId: null, kind: "imported", data: { source: `${i.key} on Jira`, url: `${client.origin}/browse/${i.key}` }, createdAt: new Date() },
      });
      snap.f = v;
      report.counts.cardsCreated++;
    } else {
      cardId = existing.cardId;
      const cur = await currentValues(cardId, subtaskPass);
      const before = snap.f ?? {};
      const change: Partial<Values> = {};
      for (const k of Object.keys(v) as (keyof Values)[]) {
        if (v[k] === cur[k]) {
          before[k] = v[k];
          continue;
        }
        if (before[k] === undefined || before[k] === cur[k]) {
          (change as Record<string, string>)[k] = v[k];
          before[k] = v[k];
        } else if (before[k] !== v[k]) report.keptLocal++;
      }
      snap.f = before;
      if (Object.keys(change).length) {
        await applyValues(cardId, change, b, subtaskPass);
        report.counts.cardsUpdated++;
      }
    }

    // Relations, resolved once every card exists.
    if (!subtaskPass) {
      const epicKey = fields.epicLink && typeof f[fields.epicLink] === "string" ? (f[fields.epicLink] as string) : undefined;
      const parentIsEpic = f.parent && (f.parent.fields?.issuetype?.hierarchyLevel === 1 || f.parent.fields?.issuetype?.name?.toLowerCase() === "epic" || f.parent.fields?.issuetype == null);
      snap.rel = {
        epic: parentIsEpic ? { id: f.parent!.id } : epicKey ? { key: epicKey } : undefined,
        links: linksOf(i),
      };
      if (fields.rank && typeof f[fields.rank] === "string") snap.rank = f[fields.rank] as string;
    } else {
      snap.rel = { links: linksOf(i) };
    }

    // Watchers: the reporter, a matched assignee, and Jira's watchers.
    const watcherIds = new Set<string>();
    for (const u of [f.reporter, f.assignee]) if (u && userMap.has(u.accountId)) watcherIds.add(userMap.get(u.accountId)!);
    if ((f.watches?.watchCount ?? 0) > 0) {
      try {
        for (const w of await client.watchers(i.id)) if (userMap.has(w.accountId)) watcherIds.add(userMap.get(w.accountId)!);
      } catch {
        skip("Watchers", "Jira didn’t return them", i.key);
      }
    }

    // Comments, oldest first; ones already imported are skipped.
    snap.comments ??= {};
    let comments = f.comment?.comments ?? [];
    if ((f.comment?.total ?? 0) > comments.length) comments = await client.comments(i.id);
    for (const c of comments) {
      if (snap.comments[c.id]) continue;
      const member = c.author ? userMap.get(c.author.accountId) : undefined;
      const body = JSON.stringify(toDoc(c.body, i));
      const row = await db.comment.create({
        data: {
          cardId,
          authorId: member ?? actorId!,
          importedAuthor: member ? null : (c.author?.displayName ?? "Someone on Jira"),
          body,
          createdAt: c.created ? new Date(c.created) : new Date(),
        },
        select: { id: true },
      });
      snap.comments[c.id] = row.id;
      if (member) watcherIds.add(member);
      report.counts.comments++;
    }
    if (watcherIds.size) {
      const r = await db.cardWatcher.createMany({ data: [...watcherIds].map((userId) => ({ cardId, userId })), skipDuplicates: true });
      report.counts.watchers += r.count;
    }

    // Attachments.
    snap.attachments ??= {};
    for (const a of f.attachment ?? []) {
      if (snap.attachments[a.id]) continue;
      if (a.size > MAX_IMPORT_ATTACHMENT_BYTES) {
        skip(`Attachment ${a.filename}`, "larger than 95 MB", i.key);
        snap.attachments[a.id] = "skipped";
        continue;
      }
      const got = await client.download(a.content, MAX_IMPORT_ATTACHMENT_BYTES);
      if ("skipped" in got) {
        skip(`Attachment ${a.filename}`, got.skipped, i.key);
        continue;
      }
      const storageKey = objectKey(ws, cardId, a.filename);
      await deps.putObject(storageKey, got.bytes, a.mimeType || got.mimeType);
      const member = a.author ? userMap.get(a.author.accountId) : undefined;
      const row = await db.attachment.create({
        data: {
          cardId,
          workspaceId: ws,
          fileName: a.filename.slice(0, 255),
          mimeType: a.mimeType || got.mimeType,
          sizeBytes: got.bytes.byteLength,
          storageKey,
          uploadedById: member ?? actorId!,
          createdAt: a.created ? new Date(a.created) : new Date(),
        },
        select: { id: true },
      });
      snap.attachments[a.id] = row.id;
      report.counts.attachments++;
    }

    await db.importedCard.upsert({
      where: { cardId },
      create: { cardId, workspaceId: ws, externalRef, externalKey: i.key, snapshot: snap as Prisma.InputJsonValue },
      update: { externalKey: i.key, snapshot: snap as Prisma.InputJsonValue },
    });
  }

  const ISSUE_FIELDS = [
    "summary", "description", "issuetype", "status", "priority", "labels", "duedate", "created", "assignee", "reporter",
    "parent", "issuelinks", "comment", "attachment", "components", "fixVersions", "watches",
    ...[fields.points, fields.sprint, fields.epicLink, fields.rank].filter((x): x is string => !!x),
  ];

  async function save(extra: Partial<{ status: string }> = {}) {
    report.requests = client.requests;
    await db.jiraImport.update({
      where: { id: importId },
      data: { progress: progress as unknown as Prisma.InputJsonValue, report: report as unknown as Prisma.InputJsonValue, cloudId, ...extra },
    });
  }

  await save({ status: "importing" });

  // ── Cards, project by project: top-level issues first, then sub-tasks ──
  if (progress.phase === "import") {
    for (let pi = progress.projectIndex; pi < projects.length; pi++) {
      const p = projects[pi];
      const b = await ensureBoard(p);
      for (const pass of [1, 2] as const) {
        if (pi === progress.projectIndex && pass < progress.pass) continue;
        let token = pi === progress.projectIndex && pass === progress.pass ? progress.pageToken : null;
        if (!token) progress = { phase: "import", projectIndex: pi, pass, pageToken: null, seen: pass === 1 ? 0 : progress.seen, total: pass === 1 ? await client.approximateCount(jqlFor(p.key)) : progress.total };
        for (;;) {
          const page = await client.search(jqlFor(p.key, pass), ISSUE_FIELDS, token);
          for (const issue of page.issues) await importIssue(issue, p, b, pass === 2);
          token = page.nextPageToken ?? null;
          progress = { ...progress, pageToken: token, seen: progress.seen + page.issues.length };
          await save();
          await checkCancelled(deps, importId);
          if (!token || page.isLast || page.issues.length === 0) break;
        }
      }
      progress = { ...progress, projectIndex: pi + 1, pass: 1, pageToken: null };
    }
    progress = { ...progress, phase: "relations" };
    await save();
  }

  // ── Epics and links, now that every card exists ──
  const imported = await db.importedCard.findMany({
    where: { workspaceId: ws, externalRef: { startsWith: `jira:${cloudId}:` } },
    select: { cardId: true, externalRef: true, externalKey: true, snapshot: true, card: { select: { type: true, parentCardId: true, epicId: true, rank: true, createdAt: true } } },
  });
  const byRef = new Map(imported.map((r) => [r.externalRef, r]));
  const byKey = new Map(imported.map((r) => [r.externalKey.toUpperCase(), r]));
  const keys = new Set(projects.map((p) => p.key.toUpperCase()));
  const inRun = imported.filter((r) => keys.has(r.externalKey.split("-")[0].toUpperCase()));

  if (progress.phase === "relations") {
    for (const r of inRun) {
      const snap = (r.snapshot ?? {}) as Snapshot;
      const rel = snap.rel;
      if (!rel) continue;
      // Epic
      if (rel.epic && !r.card.parentCardId && r.card.type !== "epic") {
        const epic = rel.epic.id ? byRef.get(ref(rel.epic.id)) : rel.epic.key ? byKey.get(rel.epic.key.toUpperCase()) : undefined;
        const want = epic && epic.card.type === "epic" && !epic.card.parentCardId ? epic.cardId : null;
        const before = snap.f?.epic;
        const cur = r.card.epicId ?? "";
        if (want && cur !== want && (before === undefined || before === cur)) {
          await db.card.update({ where: { id: r.cardId }, data: { epicId: want } });
          snap.f = { ...snap.f, epic: want };
          await db.importedCard.update({ where: { cardId: r.cardId }, data: { snapshot: snap as Prisma.InputJsonValue } });
        } else if (want && cur !== want) report.keptLocal++;
        else if (!want && rel.epic && !epic) skip("Epic link", "its epic wasn’t imported", r.externalKey);
      }
      // Links (each one is listed on both issues; the unique index drops the repeat)
      for (const l of rel.links ?? []) {
        const other = byRef.get(ref(l.otherId));
        if (!other) {
          skip("Link", "the linked issue wasn’t imported", r.externalKey);
          continue;
        }
        if (other.cardId === r.cardId) continue;
        const o = orientLink(r.cardId, other.cardId, l.choice as Parameters<typeof orientLink>[2]);
        const res = await db.cardLink.createMany({ data: [{ ...o, createdById: null }], skipDuplicates: true });
        report.counts.links += res.count;
      }
    }
    for (const t of otherLinkTypes) skip(`Link type “${t}”`, "came over as “relates to”");
    progress = { ...progress, phase: "rank" };
    await save();
  }

  // ── Backlog order: Jira's rank, for imported cards that don't have one yet ──
  if (progress.phase === "rank") {
    const unranked = inRun
      .filter((r) => !r.card.parentCardId && r.card.type !== "epic" && r.card.rank == null)
      .map((r) => ({ id: r.cardId, jira: ((r.snapshot ?? {}) as Snapshot).rank ?? "", created: r.card.createdAt.getTime() }))
      .sort((a, b) => (a.jira && b.jira ? (a.jira < b.jira ? -1 : a.jira > b.jira ? 1 : 0) : a.jira ? -1 : b.jira ? 1 : a.created - b.created));
    if (unranked.length) {
      const last = await db.card.findFirst({ where: { rank: { not: null }, column: { board: { workspaceId: ws } } }, orderBy: { rank: "desc" }, select: { rank: true } });
      const ranks = generateNKeysBetween(last?.rank ?? null, null, unranked.length);
      for (let k = 0; k < unranked.length; k += 500) {
        const ids = unranked.slice(k, k + 500).map((u) => u.id);
        const rs = ranks.slice(k, k + 500);
        await db.$executeRaw`UPDATE "Card" AS c SET "rank" = v.rank FROM unnest(${ids}::text[], ${rs}::text[]) AS v(id, rank) WHERE c.id = v.id AND c."rank" IS NULL`;
      }
    }
  }

  report.requests = client.requests;
  await db.jiraImport.update({
    where: { id: importId },
    data: { status: "done", tokenCipher: null, finishedAt: new Date(), progress: Prisma.DbNull, report: report as unknown as Prisma.InputJsonValue, error: null },
  });
  return report;
}

/** End a run that failed: keep the report so far, drop the token. */
export async function failImport(deps: Deps, importId: string, err: unknown) {
  const cancelled = err instanceof Cancelled;
  const message = err instanceof JiraError ? err.message : err instanceof Error ? err.message : String(err);
  await deps.prisma.jiraImport.updateMany({
    where: { id: importId },
    data: cancelled
      ? { tokenCipher: null, finishedAt: new Date() }
      : { status: "failed", error: message.slice(0, 1000), tokenCipher: null, finishedAt: new Date() },
  });
}
