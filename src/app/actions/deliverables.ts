"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  getProjectForUser,
  getDeliverableForUser,
  getMilestoneForUser,
  getCardForUser,
  boardVisibilityWhere,
} from "@/lib/authz";
import { positionBetween } from "@/lib/ordering";
import { DELIVERABLE_TYPES, DELIVERABLE_STATUSES } from "@/lib/methodology";

const Name = z.string().trim().min(1, "Required").max(180);

function projectPath(projectId: string) {
  return `/projects/${projectId}`;
}

async function projectWorkspace(projectId: string) {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  return p?.workspaceId ?? null;
}

// ── Deliverables ─────────────────────────────────────────────────────────────

export async function createDeliverable(projectId: string, name: string, type: string) {
  const project = await getProjectForUser(projectId);
  if (!project) return { error: "Project not found." };
  const parsedName = Name.safeParse(name);
  if (!parsedName.success) return { error: "Deliverable name is required." };
  const parsedType = z.enum(DELIVERABLE_TYPES).catch("other").parse(type);

  const last = await prisma.deliverable.findFirst({
    where: { projectId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const deliverable = await prisma.deliverable.create({
    data: { projectId, name: parsedName.data, type: parsedType, position: positionBetween(last?.position ?? null, null) },
    select: { id: true, name: true, type: true, status: true, phaseId: true, cardId: true },
  });
  revalidatePath(projectPath(projectId));
  return { deliverable };
}

export async function renameDeliverable(id: string, name: string) {
  const d = await getDeliverableForUser(id);
  if (!d) return { error: "Deliverable not found." };
  const parsed = Name.safeParse(name);
  if (!parsed.success) return { error: "Name is required." };
  await prisma.deliverable.update({ where: { id }, data: { name: parsed.data } });
  revalidatePath(projectPath(d.projectId));
}

export async function setDeliverableType(id: string, type: string) {
  const d = await getDeliverableForUser(id);
  if (!d) return { error: "Deliverable not found." };
  const parsed = z.enum(DELIVERABLE_TYPES).safeParse(type);
  if (!parsed.success) return { error: "Invalid type." };
  await prisma.deliverable.update({ where: { id }, data: { type: parsed.data } });
  revalidatePath(projectPath(d.projectId));
}

export async function setDeliverableStatus(id: string, status: string) {
  const d = await getDeliverableForUser(id);
  if (!d) return { error: "Deliverable not found." };
  const parsed = z.enum(DELIVERABLE_STATUSES).safeParse(status);
  if (!parsed.success) return { error: "Invalid status." };
  await prisma.deliverable.update({ where: { id }, data: { status: parsed.data } });
  revalidatePath(projectPath(d.projectId));
}

export async function setDeliverablePhase(id: string, phaseId: string | null) {
  const d = await getDeliverableForUser(id);
  if (!d) return { error: "Deliverable not found." };
  if (phaseId) {
    const phase = await prisma.phase.findFirst({ where: { id: phaseId, projectId: d.projectId }, select: { id: true } });
    if (!phase) return { error: "Phase not found." };
  }
  await prisma.deliverable.update({ where: { id }, data: { phaseId } });
  revalidatePath(projectPath(d.projectId));
}

export async function linkDeliverableCard(id: string, cardId: string | null) {
  const d = await getDeliverableForUser(id);
  if (!d) return { error: "Deliverable not found." };
  const workspaceId = await projectWorkspace(d.projectId);
  if (!workspaceId) return { error: "Project not found." };

  if (cardId) {
    // Group-aware access to the target card, not just workspace membership.
    if (!(await getCardForUser(cardId))) return { error: "Card not found." };
    const card = await prisma.card.findUnique({
      where: { id: cardId },
      select: { id: true, title: true, column: { select: { board: { select: { id: true, name: true, workspaceId: true } } } } },
    });
    // Deliverables only ever link to top-level cards, never subtasks, in their own workspace.
    if (!card || !card.column || card.column.board.workspaceId !== workspaceId) return { error: "Card not found." };
    await prisma.deliverable.update({ where: { id }, data: { cardId } });
    revalidatePath(projectPath(d.projectId));
    return { card: { id: card.id, title: card.title, boardId: card.column.board.id, boardName: card.column.board.name } };
  }

  await prisma.deliverable.update({ where: { id }, data: { cardId: null } });
  revalidatePath(projectPath(d.projectId));
  return { card: null };
}

export async function deleteDeliverable(id: string) {
  const d = await getDeliverableForUser(id);
  if (!d) return { error: "Deliverable not found." };
  await prisma.deliverable.delete({ where: { id } });
  revalidatePath(projectPath(d.projectId));
}

/** All cards in the project's workspace, for the link picker. */
export async function listLinkableCards(projectId: string) {
  const project = await getProjectForUser(projectId);
  if (!project) return { cards: [] };
  const workspaceId = await projectWorkspace(projectId);
  if (!workspaceId) return { cards: [] };
  const cards = await prisma.card.findMany({
    // Only cards on boards the user can actually see (respects group access).
    where: { column: { board: { workspaceId, ...(await boardVisibilityWhere()) } } },
    orderBy: [{ column: { board: { name: "asc" } } }, { title: "asc" }],
    select: { id: true, title: true, column: { select: { board: { select: { name: true } } } } },
    take: 500,
  });
  return { cards: cards.map((c) => ({ id: c.id, title: c.title, boardName: c.column!.board.name })) };
}

// ── Milestones ───────────────────────────────────────────────────────────────

export async function createMilestone(projectId: string, name: string, dueIso: string | null) {
  const project = await getProjectForUser(projectId);
  if (!project) return { error: "Project not found." };
  const parsed = Name.safeParse(name);
  if (!parsed.success) return { error: "Milestone name is required." };
  const dueDate = dueIso ? new Date(dueIso) : null;
  if (dueIso && Number.isNaN(dueDate!.getTime())) return { error: "Invalid date." };

  const last = await prisma.milestone.findFirst({
    where: { projectId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const milestone = await prisma.milestone.create({
    data: { projectId, name: parsed.data, dueDate, position: positionBetween(last?.position ?? null, null) },
    select: { id: true, name: true, dueDate: true, completedAt: true },
  });
  revalidatePath(projectPath(projectId));
  return {
    milestone: {
      id: milestone.id,
      name: milestone.name,
      dueDate: milestone.dueDate ? milestone.dueDate.toISOString() : null,
      completedAt: milestone.completedAt ? milestone.completedAt.toISOString() : null,
    },
  };
}

export async function toggleMilestone(id: string, completed: boolean) {
  const m = await getMilestoneForUser(id);
  if (!m) return { error: "Milestone not found." };
  await prisma.milestone.update({ where: { id }, data: { completedAt: completed ? new Date() : null } });
  revalidatePath(projectPath(m.projectId));
}

export async function setMilestoneDue(id: string, dueIso: string | null) {
  const m = await getMilestoneForUser(id);
  if (!m) return { error: "Milestone not found." };
  const dueDate = dueIso ? new Date(dueIso) : null;
  if (dueIso && Number.isNaN(dueDate!.getTime())) return { error: "Invalid date." };
  await prisma.milestone.update({ where: { id }, data: { dueDate } });
  revalidatePath(projectPath(m.projectId));
}

export async function deleteMilestone(id: string) {
  const m = await getMilestoneForUser(id);
  if (!m) return { error: "Milestone not found." };
  await prisma.milestone.delete({ where: { id } });
  revalidatePath(projectPath(m.projectId));
}
