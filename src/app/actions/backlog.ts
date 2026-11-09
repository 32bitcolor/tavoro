"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getCardForUser } from "@/lib/authz";
import { getActiveMembership, getCurrentUser } from "@/lib/dal";
import { recordActivity } from "@/lib/card-activity";
import { ensureRanks, rankBetween } from "@/lib/backlog";
import { asSprintReport, nextSprintName, type SprintReport, type SprintTally } from "@/lib/sprint";
import { assignCardToSprint } from "@/app/actions/sprints";
import { recordSprintDay } from "@/lib/sprint-stats";

// Backlog planning and the sprint lifecycle (docs/JIRA-PARITY.md, phase 4).
// A sprint goes planned → active (Start sprint) → completed (Complete sprint, which
// moves its unfinished cards on). Ranks are one order across every board.

function revalidate() {
  revalidatePath("/sprints");
  revalidatePath("/sprints/backlog");
}

async function sprintOf(sprintId: string) {
  const m = await getActiveMembership();
  if (!m) return null;
  return prisma.sprint.findFirst({
    where: { id: sprintId, workspaceId: m.workspaceId },
    select: { id: true, name: true, status: true, workspaceId: true, report: true, startDate: true, endDate: true },
  });
}

/**
 * Put a card in a section of the backlog (a sprint, or the backlog when sprintId is
 * null) between two neighbours: `prevId` above it and `nextId` below it, either null
 * for that end. Neighbours may be on any board in the workspace.
 */
export async function planCard(cardId: string, sprintId: string | null, prevId: string | null, nextId: string | null) {
  const m = await getActiveMembership();
  const access = await getCardForUser(cardId);
  if (!m || !access) return { error: "Card not found." };
  const card = await prisma.card.findUnique({ where: { id: cardId }, select: { parentCardId: true, type: true, sprintId: true } });
  if (!card || card.parentCardId) return { error: "Subtasks follow their card; plan the card instead." };
  if (card.type === "epic") return { error: "Epics aren’t planned in sprints; their cards are." };
  if (prevId === cardId || nextId === cardId) return { error: "A card can’t be placed next to itself." };

  if (sprintId !== card.sprintId) {
    if (sprintId) {
      const s = await sprintOf(sprintId);
      if (!s) return { error: "Sprint not found." };
      if (s.status === "completed") return { error: "That sprint is complete. Plan cards into an active or planned sprint." };
    }
    const res = await assignCardToSprint(cardId, sprintId);
    if ("error" in res) return res;
  }

  const ids = [prevId, nextId].filter((x): x is string => !!x);
  const neighbours = async () =>
    prisma.card.findMany({ where: { id: { in: ids }, column: { board: { workspaceId: m.workspaceId } } }, select: { id: true, rank: true } });
  let rows = await neighbours();
  if (rows.length !== ids.length) return { error: "Those cards moved. Refresh the backlog and try again." };
  if (rows.some((r) => r.rank == null)) {
    await ensureRanks(m.workspaceId);
    rows = await neighbours();
  }
  const rankOf = (id: string | null) => (id ? rows.find((r) => r.id === id)?.rank ?? null : null);
  const rank = rankBetween(rankOf(prevId), rankOf(nextId));
  await prisma.card.update({ where: { id: cardId }, data: { rank } });
  revalidate();
  return { ok: true as const, rank };
}

const SprintStart = z.object({
  name: z.string().trim().min(1, "Give the sprint a name.").max(120),
  goal: z.string().trim().max(500).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date."),
});

async function tally(sprintId: string): Promise<{ done: SprintTally; notDone: SprintTally }> {
  const cards = await prisma.card.findMany({
    where: { sprintId, columnId: { not: null } },
    select: { id: true, estimate: true, status: { select: { category: true } } },
  });
  const t = (list: typeof cards): SprintTally => ({
    count: list.length,
    estimate: Math.round(list.reduce((n, c) => n + (c.estimate ?? 0), 0) * 100) / 100,
    cardIds: list.map((c) => c.id),
  });
  return { done: t(cards.filter((c) => c.status?.category === "done")), notDone: t(cards.filter((c) => c.status?.category !== "done")) };
}

/** Start a planned sprint: set its name, goal and dates, and note what it starts with. */
export async function startSprint(sprintId: string, input: { name: string; goal?: string; startDate: string; endDate: string }) {
  const s = await sprintOf(sprintId);
  if (!s) return { error: "Sprint not found." };
  if (s.status !== "planned") return { error: s.status === "active" ? "That sprint has already started." : "That sprint is complete." };
  const parsed = SprintStart.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the sprint’s details." };
  const { name, goal, startDate, endDate } = parsed.data;
  if (endDate < startDate) return { error: "The end date must be on or after the start date." };

  const { done, notDone } = await tally(sprintId);
  const report: SprintReport = {
    ...asSprintReport(s.report),
    committed: {
      at: new Date().toISOString(),
      count: done.count + notDone.count,
      estimate: Math.round((done.estimate + notDone.estimate) * 100) / 100,
      cardIds: [...done.cardIds, ...notDone.cardIds],
    },
  };
  await prisma.sprint.update({
    where: { id: sprintId },
    data: {
      name,
      goal: goal || null,
      status: "active",
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      report: report as Prisma.InputJsonValue,
    },
  });
  // The burndown's first point.
  await recordSprintDay(prisma, sprintId, new Date(`${startDate}T12:00:00Z`) < new Date() ? new Date(`${startDate}T12:00:00Z`) : new Date());
  revalidate();
  revalidatePath(`/sprints/${sprintId}`);
  return { ok: true as const };
}

/** What completing a sprint would do, for its dialog: counts, and where unfinished cards could go. */
export async function getSprintCompletion(sprintId: string) {
  const s = await sprintOf(sprintId);
  if (!s) return { error: "Sprint not found." };
  const { done, notDone } = await tally(sprintId);
  const planned = await prisma.sprint.findMany({
    where: { workspaceId: s.workspaceId, status: "planned" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  return {
    sprint: { id: s.id, name: s.name, status: s.status },
    done: { count: done.count, estimate: done.estimate },
    notDone: { count: notDone.count, estimate: notDone.estimate },
    plannedSprints: planned,
    newSprintName: nextSprintName(s.name),
  };
}

/**
 * Complete an active sprint. Its done cards stay with it; unfinished ones move to
 * `moveTo`: "backlog", "new" (a new planned sprint named after this one), or the id of
 * a planned sprint. The result is kept on Sprint.report.
 */
export async function completeSprint(sprintId: string, moveTo: string) {
  const s = await sprintOf(sprintId);
  if (!s) return { error: "Sprint not found." };
  if (s.status !== "active") return { error: s.status === "planned" ? "Start the sprint before completing it." : "That sprint is already complete." };

  let dest: { id: string; name: string } | null = null;
  if (moveTo === "new") {
    dest = await prisma.sprint.create({ data: { workspaceId: s.workspaceId, name: nextSprintName(s.name) }, select: { id: true, name: true } });
  } else if (moveTo !== "backlog") {
    const target = await sprintOf(moveTo);
    if (!target || target.id === s.id || target.status !== "planned") return { error: "Pick a planned sprint, a new sprint, or the backlog." };
    dest = { id: target.id, name: target.name };
  }

  const { done, notDone } = await tally(sprintId);
  const prior = asSprintReport(s.report);
  const committed = new Set(prior.committed?.cardIds ?? []);
  const report: SprintReport = {
    ...prior,
    completed: {
      at: new Date().toISOString(),
      done,
      notDone,
      movedTo: dest,
      // A start recorded without ids (a restored backup) can't tell what was added.
      addedAfterStart: prior.committed?.cardIds?.length ? done.cardIds.filter((id) => !committed.has(id)).length : 0,
    },
  };

  const me = (await getCurrentUser())?.id;
  await prisma.$transaction(async (tx) => {
    // The burndown's last point, before the unfinished cards leave.
    await recordSprintDay(tx, sprintId, new Date(), {
      scopeCards: done.count + notDone.count,
      scopePoints: Math.round((done.estimate + notDone.estimate) * 100) / 100,
      doneCards: done.count,
      donePoints: done.estimate,
    });
    await tx.card.updateMany({ where: { id: { in: notDone.cardIds } }, data: { sprintId: dest?.id ?? null } });
    for (const id of notDone.cardIds) await recordActivity(id, me, "sprint", { from: s.name, to: dest?.name ?? null }, tx);
    await tx.sprint.update({ where: { id: sprintId }, data: { status: "completed", completedAt: new Date(), report: report as Prisma.InputJsonValue } });
  });
  revalidate();
  revalidatePath(`/sprints/${sprintId}`);
  revalidatePath("/boards", "layout");
  return { ok: true as const, done: done.count, moved: notDone.count, movedTo: dest };
}
