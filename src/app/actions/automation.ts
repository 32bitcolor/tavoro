"use server";

import { revalidatePath } from "next/cache";
import { Prisma, Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { RuleInput, describeRule, type Action } from "@/lib/automation/rules";
import { compileQuery } from "@/lib/query/compile";
import { QueryError } from "@/lib/query/parse";
import { workspaceQueryContext } from "@/lib/query/context";

// Settings → Automation (docs/JIRA-PARITY.md, phase 9). Admins only.

async function admin() {
  const m = await getActiveMembership();
  return m && m.role === Role.ADMIN ? m : null;
}

/** Check what a rule names exists now, so mistakes show when saving, not at 3 a.m. */
async function checkNames(workspaceId: string, actions: Action[]): Promise<string | null> {
  const [statuses, labels, fields, members] = await Promise.all([
    prisma.workspaceStatus.findMany({ where: { workspaceId }, select: { name: true } }),
    prisma.label.findMany({ where: { workspaceId }, select: { name: true } }),
    prisma.customField.findMany({ where: { workspaceId }, select: { name: true } }),
    prisma.membership.findMany({ where: { workspaceId, suspendedAt: null }, select: { user: { select: { name: true, email: true } } } }),
  ]);
  const has = (list: { name: string }[], n: string) => list.some((x) => x.name.toLowerCase() === n.trim().toLowerCase());
  const person = (n: string) => members.some((m) => m.user.email.toLowerCase() === n.trim().toLowerCase() || (m.user.name ?? "").toLowerCase() === n.trim().toLowerCase());
  for (const a of actions) {
    if (a.kind === "set_status" && !has(statuses, a.status)) return `No status “${a.status}”. Statuses: ${statuses.map((s) => s.name).join(", ")}.`;
    if ((a.kind === "add_label" || a.kind === "remove_label") && !has(labels, a.label)) return `No label “${a.label}”.`;
    if (a.kind === "set_field" && !has(fields, a.field)) return `No custom field “${a.field}”.`;
    if ((a.kind === "assign" || a.kind === "watch") && !person(a.person)) return `No member “${a.person}”. Use an email.`;
    if (a.kind === "unassign" && a.person.trim().toLowerCase() !== "everyone" && !person(a.person)) return `No member “${a.person}”. Use an email, or “everyone”.`;
    if (a.kind === "notify" && a.to === "person" && !person(a.person)) return `No member “${a.person}” to email.`;
  }
  return null;
}

async function checkCondition(workspaceId: string, userId: string, condition: string) {
  if (!condition.trim()) return null;
  try {
    await compileQuery(condition, await workspaceQueryContext(prisma, workspaceId, userId));
    return null;
  } catch (e) {
    if (e instanceof QueryError) return { error: `Condition: ${e.message}`, pos: e.pos, end: e.end };
    throw e;
  }
}

export async function saveAutomationRule(id: string | null, input: unknown) {
  const m = await admin();
  if (!m) return { error: "Only workspace admins can edit automation." };
  const p = RuleInput.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the rule." };
  const r = p.data;
  if (r.boardId && !(await prisma.board.findFirst({ where: { id: r.boardId, workspaceId: m.workspaceId }, select: { id: true } }))) return { error: "Board not found." };
  if (r.trigger.kind === "schedule" && !r.condition.trim()) return { error: "A scheduled rule needs a condition, so it doesn’t change every card." };
  if (r.trigger.kind === "status_changed" && r.trigger.to && !(await prisma.workspaceStatus.findFirst({ where: { workspaceId: m.workspaceId, name: { equals: r.trigger.to, mode: "insensitive" } } }))) return { error: `No status “${r.trigger.to}”.` };
  if (r.trigger.kind === "field_changed" && r.trigger.field === "custom" && !(await prisma.customField.findFirst({ where: { workspaceId: m.workspaceId, name: { equals: r.trigger.custom, mode: "insensitive" } } }))) return { error: `No custom field “${r.trigger.custom}”.` };
  const cond = await checkCondition(m.workspaceId, m.userId, r.condition);
  if (cond) return cond;
  const names = await checkNames(m.workspaceId, r.actions);
  if (names) return { error: names };
  const data = {
    name: r.name,
    enabled: r.enabled,
    boardId: r.boardId,
    trigger: r.trigger as Prisma.InputJsonValue,
    condition: r.condition.trim(),
    actions: r.actions as Prisma.InputJsonValue,
  };
  if (id) {
    const res = await prisma.automationRule.updateMany({ where: { id, workspaceId: m.workspaceId }, data });
    if (!res.count) return { error: "Rule not found." };
  } else await prisma.automationRule.create({ data: { ...data, workspaceId: m.workspaceId, createdById: m.userId } });
  revalidatePath("/settings/automation");
  return { ok: true as const, summary: describeRule(r) };
}

export async function setAutomationRuleEnabled(id: string, enabled: boolean) {
  const m = await admin();
  if (!m) return { error: "Only workspace admins can edit automation." };
  await prisma.automationRule.updateMany({ where: { id, workspaceId: m.workspaceId }, data: { enabled } });
  revalidatePath("/settings/automation");
  return { ok: true as const };
}

export async function deleteAutomationRule(id: string) {
  const m = await admin();
  if (!m) return { error: "Only workspace admins can edit automation." };
  await prisma.automationRule.deleteMany({ where: { id, workspaceId: m.workspaceId } });
  revalidatePath("/settings/automation");
  return { ok: true as const };
}

export async function getAutomationRuns(id: string) {
  const m = await admin();
  if (!m) return { runs: [] };
  const rule = await prisma.automationRule.findFirst({ where: { id, workspaceId: m.workspaceId }, select: { id: true } });
  if (!rule) return { runs: [] };
  const runs = await prisma.automationRun.findMany({ where: { ruleId: id }, orderBy: { at: "desc" }, take: 50, select: { id: true, cardId: true, cardKey: true, ok: true, message: true, at: true } });
  return { runs: runs.map((r) => ({ ...r, at: r.at.toISOString() })) };
}

/** How many cards a condition matches right now (the editor's preview). */
export async function previewAutomationCondition(condition: string, boardId: string | null) {
  const m = await admin();
  if (!m) return { error: "Only workspace admins can edit automation." };
  try {
    const { where } = await compileQuery(condition, await workspaceQueryContext(prisma, m.workspaceId, m.userId));
    const count = await prisma.card.count({ where: { AND: [{ columnId: { not: null }, column: { board: { workspaceId: m.workspaceId, ...(boardId ? { id: boardId } : {}) } } }, where] } });
    return { count };
  } catch (e) {
    if (e instanceof QueryError) return { error: e.message };
    throw e;
  }
}
