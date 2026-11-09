"use server";

import { recordActivity } from "@/lib/card-activity";
import { getCurrentUser } from "@/lib/dal";
import { asCardType, asPriority } from "@/lib/card-fields";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { getCardForUser, getProjectForUser, boardVisibilityWhere } from "@/lib/authz";
import { SPRINT_STATUSES } from "@/lib/sprint";

const Name = z.string().trim().min(1, "Required").max(120);
const Goal = z.string().trim().max(500);
const StatusSchema = z.enum(SPRINT_STATUSES);

/** Resolve a sprint only if it belongs to the caller's active workspace. */
async function sprintInWorkspace(sprintId: string) {
  const m = await getActiveMembership();
  if (!m) return null;
  return prisma.sprint.findFirst({
    where: { id: sprintId, workspaceId: m.workspaceId },
    select: { id: true, status: true },
  });
}

export async function createSprint(name: string, goal?: string) {
  const m = await getActiveMembership();
  if (!m) return { error: "No active workspace." };
  const parsed = Name.safeParse(name);
  if (!parsed.success) return { error: "Sprint name is required." };
  const parsedGoal = goal ? Goal.safeParse(goal) : null;
  const sprint = await prisma.sprint.create({
    data: {
      workspaceId: m.workspaceId,
      name: parsed.data,
      goal: parsedGoal?.success ? parsedGoal.data || null : null,
    },
    select: { id: true, name: true, goal: true, status: true, startDate: true, endDate: true },
  });
  revalidatePath("/sprints");
  return { sprint };
}

export async function renameSprint(sprintId: string, name: string) {
  if (!(await sprintInWorkspace(sprintId))) return { error: "Sprint not found." };
  const parsed = Name.safeParse(name);
  if (!parsed.success) return { error: "Sprint name is required." };
  await prisma.sprint.update({ where: { id: sprintId }, data: { name: parsed.data } });
  revalidatePath("/sprints");
  return { ok: true };
}

/** Reopen a sprint (completed → active, or active → planned). Starting and completing
 *  go through startSprint / completeSprint (actions/backlog.ts), which do more. */
export async function setSprintStatus(sprintId: string, status: string) {
  const m = await getActiveMembership();
  const sprint = m && (await prisma.sprint.findFirst({ where: { id: sprintId, workspaceId: m.workspaceId }, select: { status: true } }));
  if (!sprint) return { error: "Sprint not found." };
  const parsed = StatusSchema.safeParse(status);
  if (!parsed.success) return { error: "Invalid status." };
  if (parsed.data === sprint.status) return { ok: true };
  if (parsed.data === "completed") return { error: "Complete the sprint from the Backlog or Sprints page, so its unfinished cards move on." };
  if (parsed.data === "active" && sprint.status === "planned") return { error: "Start the sprint from the Backlog or Sprints page." };
  await prisma.sprint.update({ where: { id: sprintId }, data: { status: parsed.data, completedAt: null } });
  revalidatePath("/sprints");
  return { ok: true };
}

export async function setSprintDates(sprintId: string, startDate: string | null, endDate: string | null) {
  if (!(await sprintInWorkspace(sprintId))) return { error: "Sprint not found." };
  await prisma.sprint.update({
    where: { id: sprintId },
    data: {
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
    },
  });
  revalidatePath("/sprints");
  return { ok: true };
}

export async function deleteSprint(sprintId: string) {
  if (!(await sprintInWorkspace(sprintId))) return { error: "Sprint not found." };
  // Cards keep existing; their sprintId is set null by the FK (onDelete: SetNull).
  await prisma.sprint.delete({ where: { id: sprintId } });
  revalidatePath("/sprints");
  return { ok: true };
}

/** Top-level cards not yet in any sprint that the caller can see — for the
 *  sprint board's "Add cards" picker. Returns the same shape a sprint card uses. */
export async function listAssignableCards(sprintId: string) {
  const m = await getActiveMembership();
  if (!m || !(await sprintInWorkspace(sprintId))) return { cards: [] };
  const rows = await prisma.card.findMany({
    where: {
      sprintId: null,
      columnId: { not: null },
      type: { not: "epic" },
      column: { board: { workspaceId: m.workspaceId, ...(await boardVisibilityWhere()) } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      keySeq: true,
      statusId: true,
      dueDate: true,
      type: true,
      priority: true,
      estimate: true,
      epic: { select: { id: true, title: true } },
      assignees: { select: { user: { select: { id: true, name: true, email: true } } } },
      labels: { select: { label: { select: { id: true, name: true, color: true } } } },
      column: { select: { board: { select: { id: true, cardKeyPrefix: true, project: { select: { id: true, name: true } } } } } },
    },
  });
  return {
    cards: rows.map((c) => ({
      id: c.id,
      title: c.title,
      keySeq: c.keySeq,
      statusId: c.statusId,
      dueDate: c.dueDate ? c.dueDate.toISOString() : null,
      type: asCardType(c.type),
      priority: asPriority(c.priority),
      estimate: c.estimate,
      epic: c.epic,
      boardId: c.column!.board.id,
      cardKeyPrefix: c.column!.board.cardKeyPrefix,
      project: c.column!.board.project,
      assignees: c.assignees.map((a) => a.user),
      labels: c.labels.map((l) => l.label),
    })),
  };
}

/** Assign a card to a sprint (or clear with sprintId = null). */
export async function assignCardToSprint(cardId: string, sprintId: string | null) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };
  const target = sprintId ? await sprintInWorkspace(sprintId) : null;
  if (sprintId && !target) return { error: "Sprint not found." };
  if (target?.status === "completed") return { error: "That sprint is complete. Plan cards into an active or planned sprint." };
  if (sprintId) {
    const row = await prisma.card.findUnique({ where: { id: cardId }, select: { type: true } });
    if (row?.type === "epic") return { error: "Epics aren\u2019t planned in sprints; their cards are." };
  }
  const before = await prisma.card.findUnique({ where: { id: cardId }, select: { sprint: { select: { id: true, name: true } } } });
  await prisma.card.update({ where: { id: cardId }, data: { sprintId } });
  if ((before?.sprint?.id ?? null) !== sprintId) {
    const to = sprintId ? (await prisma.sprint.findUnique({ where: { id: sprintId }, select: { name: true } }))?.name ?? null : null;
    await recordActivity(cardId, (await getCurrentUser())?.id, "sprint", { from: before?.sprint?.name ?? null, to });
  }
  revalidatePath(`/boards/${card.boardId}`);
  revalidatePath("/sprints");
  return { ok: true };
}

/** Per-project opt-in for sprint planning. */
export async function setProjectSprintsEnabled(projectId: string, enabled: boolean) {
  const project = await getProjectForUser(projectId);
  if (!project) return { error: "Project not found." };
  await prisma.project.update({ where: { id: projectId }, data: { sprintsEnabled: enabled } });
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
