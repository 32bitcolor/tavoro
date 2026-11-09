"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { seal } from "@/lib/secret-box";
import { enqueueJiraImport } from "@/lib/queues";
import { JiraClient, JiraError, normalizeSite } from "@/lib/jira/client";
import { PREFIX_RE, prefixFrom, type ImportMapping, type ImportProject } from "@/lib/jira/map";

// Settings → Import → Jira (docs/JIRA-PARITY.md, phase 5). Admins only; not exposed to
// MCP. The API token is sealed onto the run while the run needs it and wiped when it
// ends; it's never shown again.

async function admin() {
  const m = await getActiveMembership();
  return m && m.role === Role.ADMIN ? m : null;
}

async function runOf(importId: string) {
  const m = await admin();
  if (!m) return null;
  const run = await prisma.jiraImport.findFirst({ where: { id: importId, workspaceId: m.workspaceId } });
  return run ? { m, run } : null;
}

function jiraMessage(e: unknown) {
  return e instanceof JiraError ? e.message : "Couldn’t reach Jira. Check the site and try again.";
}

const ACTIVE = ["scanning", "importing"];

/** Step 1: check the site, email and token, and list the projects they can see. */
export async function connectJira(input: { site: string; email: string; token: string }) {
  const m = await admin();
  if (!m) return { error: "Only workspace admins can import." };
  const site = normalizeSite(input.site);
  if ("error" in site) return { error: site.error };
  const email = z.string().trim().email().safeParse(input.email);
  if (!email.success) return { error: "Enter the email of the Atlassian account the token belongs to." };
  const token = input.token.trim();
  if (token.length < 8 || token.length > 500) return { error: "Paste the API token from id.atlassian.com → Security → API tokens." };
  const busy = await prisma.jiraImport.findFirst({ where: { workspaceId: m.workspaceId, status: { in: ACTIVE } }, select: { id: true } });
  if (busy) return { error: "An import is already running in this workspace. Wait for it to finish, or cancel it.", importId: busy.id };

  const client = new JiraClient(site.origin, email.data, token);
  let projects;
  let cloudId: string;
  try {
    await client.myself();
    cloudId = await client.cloudId();
    projects = await client.projects();
  } catch (e) {
    return { error: jiraMessage(e) };
  }
  if (projects.length === 0) return { error: "That account can’t see any Jira projects." };
  const run = await prisma.jiraImport.create({
    data: {
      workspaceId: m.workspaceId,
      createdById: m.userId,
      // Just the host for Jira Cloud; the full address for an approved http host (a test mock).
      site: site.origin.startsWith("https://") ? site.host : site.origin,
      email: email.data,
      cloudId,
      tokenCipher: seal(token),
      status: "connected",
      // Remember the project list on the run (the picker reads it from here).
      scan: { available: projects.map((p) => ({ id: p.id, key: p.key, name: p.name })) },
    },
    select: { id: true },
  });
  revalidatePath("/settings/import");
  return { importId: run.id };
}

const Target = z.union([
  z.object({ kind: z.literal("new"), name: z.string().trim().min(1).max(120), prefix: z.string().trim().toUpperCase() }),
  z.object({ kind: z.literal("board"), boardId: z.string().min(1) }),
]);
const Selection = z.array(z.object({ id: z.string(), key: z.string(), name: z.string(), target: Target })).min(1, "Pick at least one project.").max(50);

/** Step 2: which projects, and where each goes. Starts the dry run. */
export async function chooseJiraProjects(importId: string, selection: unknown) {
  const ctx = await runOf(importId);
  if (!ctx) return { error: "Import not found." };
  const { m, run } = ctx;
  if (!["connected", "ready", "failed"].includes(run.status) || !run.tokenCipher) return { error: "This import can’t change now. Start a new one." };
  const parsed = Selection.safeParse(selection);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the projects." };
  const available = ((run.scan as { available?: { id: string; key: string }[] } | null)?.available ?? []).map((p) => p.id);
  const prefixes = new Set<string>();
  for (const p of parsed.data) {
    if (!available.includes(p.id)) return { error: `Project ${p.key} isn’t available to this account.` };
    if (p.target.kind === "board") {
      const b = await prisma.board.findFirst({ where: { id: p.target.boardId, workspaceId: m.workspaceId }, select: { id: true } });
      if (!b) return { error: `Pick a board for ${p.key}.` };
      continue;
    }
    if (!PREFIX_RE.test(p.target.prefix)) return { error: `${p.key}: the key prefix must be 2–8 letters or digits, starting with a letter.` };
    if (prefixes.has(p.target.prefix)) return { error: `Two projects can’t share the key prefix ${p.target.prefix}.` };
    prefixes.add(p.target.prefix);
    // A board an earlier import made for this project is reused, keeping its prefix.
    const own = await prisma.board.findUnique({ where: { workspaceId_externalRef: { workspaceId: m.workspaceId, externalRef: `jira:${run.cloudId}:project:${p.id}` } }, select: { id: true } });
    if (!own) {
      const taken = await prisma.board.findFirst({ where: { workspaceId: m.workspaceId, cardKeyPrefix: { equals: p.target.prefix, mode: "insensitive" } }, select: { name: true } });
      if (taken) return { error: `${p.key}: the key prefix ${p.target.prefix} is used by the board “${taken.name}”. Pick another, or import into that board.` };
    }
  }
  const busy = await prisma.jiraImport.findFirst({ where: { workspaceId: m.workspaceId, status: { in: ACTIVE }, id: { not: importId } }, select: { id: true } });
  if (busy) return { error: "Another import is running in this workspace." };
  const scan = (run.scan as Record<string, unknown> | null) ?? {};
  await prisma.jiraImport.update({
    where: { id: importId },
    data: {
      projects: parsed.data as unknown as Prisma.InputJsonValue,
      status: "scanning",
      error: null,
      progress: Prisma.DbNull,
      scan: { available: scan.available ?? [] } as Prisma.InputJsonValue,
    },
  });
  await enqueueJiraImport("scan", importId);
  revalidatePath(`/settings/import/${importId}`);
  return { ok: true as const };
}

const MappingInput = z.object({
  statuses: z.array(z.object({ jiraId: z.string(), statusId: z.string().nullable() })).max(500),
  users: z.array(z.object({ accountId: z.string(), memberId: z.string().nullable() })).max(5000),
  types: z.array(z.object({ jiraName: z.string(), to: z.enum(["task", "bug", "story", "epic", "subtask"]) })).max(200),
  points: z.string().nullable(),
  componentsAsLabels: z.boolean(),
});

/** Step 3: the admin's changes to the proposed mapping. */
export async function saveJiraMapping(importId: string, input: unknown) {
  const ctx = await runOf(importId);
  if (!ctx) return { error: "Import not found." };
  const { m, run } = ctx;
  if (run.status !== "ready") return { error: "The mapping can be changed after the scan and before the import." };
  const parsed = MappingInput.safeParse(input);
  if (!parsed.success) return { error: "Check the mapping." };
  const mapping = run.mapping as unknown as ImportMapping;
  const [statuses, members] = await Promise.all([
    prisma.workspaceStatus.findMany({ where: { workspaceId: m.workspaceId }, select: { id: true } }),
    prisma.membership.findMany({ where: { workspaceId: m.workspaceId, suspendedAt: null }, select: { userId: true } }),
  ]);
  const okStatus = new Set(statuses.map((s) => s.id));
  const okMember = new Set(members.map((x) => x.userId));
  for (const s of parsed.data.statuses) {
    const row = mapping.statuses.find((x) => x.jiraId === s.jiraId);
    if (row) row.statusId = s.statusId && okStatus.has(s.statusId) ? s.statusId : null;
  }
  for (const u of parsed.data.users) {
    const row = mapping.users.find((x) => x.accountId === u.accountId);
    if (!row) continue;
    const id = u.memberId && okMember.has(u.memberId) ? u.memberId : null;
    if (id !== row.memberId) row.how = id ? "manual" : null;
    row.memberId = id;
  }
  for (const t of parsed.data.types) {
    const row = mapping.types.find((x) => x.jiraName === t.jiraName);
    // Jira's sub-task types stay subtasks; others can't become one (they have no parent).
    if (row && !row.subtask && t.to !== "subtask") row.to = t.to;
  }
  const numberFields = ((run.scan as { numberFields?: { id: string }[] } | null)?.numberFields ?? []).map((f) => f.id);
  mapping.fields.points = parsed.data.points && numberFields.includes(parsed.data.points) ? parsed.data.points : parsed.data.points === null ? null : mapping.fields.points;
  mapping.componentsAsLabels = parsed.data.componentsAsLabels;
  await prisma.jiraImport.update({ where: { id: importId }, data: { mapping: mapping as unknown as Prisma.InputJsonValue } });
  return { ok: true as const };
}

/** Step 4: import. */
export async function startJiraImport(importId: string) {
  const ctx = await runOf(importId);
  if (!ctx) return { error: "Import not found." };
  if (ctx.run.status !== "ready" || !ctx.run.tokenCipher) return { error: "Scan the projects first." };
  const busy = await prisma.jiraImport.findFirst({ where: { workspaceId: ctx.m.workspaceId, status: { in: ACTIVE } }, select: { id: true } });
  if (busy) return { error: "Another import is running in this workspace." };
  await prisma.jiraImport.update({ where: { id: importId }, data: { status: "importing", startedAt: new Date(), progress: Prisma.DbNull, report: Prisma.DbNull, error: null } });
  await enqueueJiraImport("import", importId);
  revalidatePath(`/settings/import/${importId}`);
  return { ok: true as const };
}

/** Stop a run. What it already brought over stays. */
export async function cancelJiraImport(importId: string) {
  const ctx = await runOf(importId);
  if (!ctx) return { error: "Import not found." };
  if (["done", "failed", "cancelled"].includes(ctx.run.status)) return { ok: true as const };
  await prisma.jiraImport.update({ where: { id: importId }, data: { status: "cancelled", tokenCipher: null, finishedAt: new Date() } });
  revalidatePath(`/settings/import/${importId}`);
  revalidatePath("/settings/import");
  return { ok: true as const };
}

/** Where a run is, for the page to poll. Never includes the token. */
export async function getJiraImport(importId: string) {
  const ctx = await runOf(importId);
  if (!ctx) return null;
  const { run } = ctx;
  return {
    id: run.id,
    site: run.site,
    email: run.email,
    status: run.status,
    hasToken: !!run.tokenCipher,
    projects: run.projects as unknown as ImportProject[],
    mapping: run.mapping as unknown as ImportMapping | null,
    scan: run.scan as Record<string, unknown> | null,
    progress: run.progress as Record<string, unknown> | null,
    report: run.report as Record<string, unknown> | null,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

/** Defaults for the project picker: a new board named after the project, keyed like it. */
export async function jiraProjectDefaults(importId: string) {
  const ctx = await runOf(importId);
  if (!ctx) return { projects: [], boards: [] };
  const available = ((ctx.run.scan as { available?: { id: string; key: string; name: string }[] } | null)?.available ?? []);
  const boards = await prisma.board.findMany({
    where: { workspaceId: ctx.m.workspaceId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, cardKeyPrefix: true, externalRef: true },
  });
  const chosen = ctx.run.projects as unknown as ImportProject[];
  return {
    projects: available.map((p) => {
      const prev = chosen.find((c) => c.id === p.id);
      const own = boards.find((b) => b.externalRef === `jira:${ctx.run.cloudId}:project:${p.id}`);
      return {
        ...p,
        // A re-run starts with the projects imported before.
        selected: !!prev || !!own,
        // A re-run defaults to the board the last import made.
        target: prev?.target ?? (own ? { kind: "new" as const, name: own.name, prefix: own.cardKeyPrefix ?? prefixFrom(p.key) } : { kind: "new" as const, name: p.name, prefix: prefixFrom(p.key) }),
        reusesBoard: own ? own.name : null,
      };
    }),
    boards: boards.map((b) => ({ id: b.id, name: b.name, prefix: b.cardKeyPrefix })),
  };
}
