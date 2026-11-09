import "server-only";
import { prisma } from "@/lib/db";
import { boardVisibilityWhere } from "@/lib/authz";
import { asCardType, asPriority } from "@/lib/card-fields";
import { asSprintReport } from "@/lib/sprint";
import { burndown, tallySprint, velocity } from "@/lib/sprint-stats";

// A sprint's report (docs/JIRA-PARITY.md, phase 6): burndown, what it committed to and
// finished, and its cards. Card lists respect board visibility; the numbers are the
// sprint's own (they include cards on boards the viewer can't open).

const CARD = {
  id: true,
  title: true,
  keySeq: true,
  type: true,
  priority: true,
  estimate: true,
  status: { select: { name: true, category: true } },
  assignees: { select: { user: { select: { id: true, name: true, email: true } } } },
  column: { select: { board: { select: { id: true, cardKeyPrefix: true } } } },
} as const;

export type ReportCard = {
  id: string;
  key: string | null;
  title: string;
  type: ReturnType<typeof asCardType>;
  priority: ReturnType<typeof asPriority>;
  estimate: number | null;
  status: string | null;
  done: boolean;
  boardId: string;
  assignees: { id: string; name: string | null; email: string }[];
};

export async function loadSprintReport(workspaceId: string, sprintId: string) {
  const sprint = await prisma.sprint.findFirst({
    where: { id: sprintId, workspaceId },
    select: { id: true, name: true, goal: true, status: true, startDate: true, endDate: true, completedAt: true, report: true, days: { orderBy: { day: "asc" } } },
  });
  if (!sprint) return null;
  const report = asSprintReport(sprint.report);
  const live = sprint.status === "completed" ? null : await tallySprint(prisma, sprint.id);
  const burn = burndown({ ...sprint, report, live });

  const visible = { workspaceId, ...(await boardVisibilityWhere()) };
  const toCard = (c: {
    id: string; title: string; keySeq: number | null; type: string; priority: string | null; estimate: number | null;
    status: { name: string; category: string } | null; assignees: { user: { id: string; name: string | null; email: string } }[];
    column: { board: { id: string; cardKeyPrefix: string | null } } | null;
  }): ReportCard => ({
    id: c.id,
    key: c.column?.board.cardKeyPrefix && c.keySeq != null ? `${c.column.board.cardKeyPrefix}-${c.keySeq}` : null,
    title: c.title,
    type: asCardType(c.type),
    priority: asPriority(c.priority),
    estimate: c.estimate,
    status: c.status?.name ?? null,
    done: c.status?.category === "done",
    boardId: c.column?.board.id ?? "",
    assignees: c.assignees.map((a) => a.user),
  });

  // Which cards: a completed sprint lists what it finished with (unfinished ones have
  // moved on); otherwise, what's in it now.
  const ids = report.completed ? [...report.completed.done.cardIds, ...report.completed.notDone.cardIds] : null;
  const rows = await prisma.card.findMany({
    where: { columnId: { not: null }, column: { board: visible }, ...(ids ? { id: { in: ids } } : { sprintId: sprint.id, type: { not: "epic" } }) },
    orderBy: [{ rank: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    select: CARD,
  });
  const cards = rows.map(toCard);
  const doneIds = report.completed ? new Set(report.completed.done.cardIds) : new Set(cards.filter((c) => c.done).map((c) => c.id));
  const committedIds = report.committed?.cardIds?.length ? new Set(report.committed.cardIds) : null;
  const hidden = ids ? ids.length - cards.length : 0;

  const tally = report.completed
    ? {
        doneCards: report.completed.done.count,
        donePoints: report.completed.done.estimate,
        notDoneCards: report.completed.notDone.count,
        notDonePoints: report.completed.notDone.estimate,
      }
    : live
      ? { doneCards: live.doneCards, donePoints: live.donePoints, notDoneCards: live.scopeCards - live.doneCards, notDonePoints: Math.round((live.scopePoints - live.donePoints) * 100) / 100 }
      : null;

  return {
    sprint: {
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      status: sprint.status,
      startDate: sprint.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: sprint.endDate?.toISOString().slice(0, 10) ?? null,
      completedAt: sprint.completedAt?.toISOString() ?? null,
    },
    committed: report.committed ? { cards: report.committed.count, points: report.committed.estimate } : null,
    tally,
    addedAfterStart: report.completed ? report.completed.addedAfterStart : committedIds ? cards.filter((c) => !committedIds.has(c.id)).length : null,
    movedTo: report.completed?.movedTo ?? null,
    burndown: burn,
    done: cards.filter((c) => doneIds.has(c.id)),
    notDone: cards.filter((c) => !doneIds.has(c.id)),
    addedIds: committedIds ? cards.filter((c) => !committedIds.has(c.id)).map((c) => c.id) : [],
    hidden,
  };
}

export async function loadVelocity(workspaceId: string, limit = 8) {
  const sprints = await prisma.sprint.findMany({
    where: { workspaceId, status: "completed", completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take: limit,
    select: { id: true, name: true, completedAt: true, report: true },
  });
  return velocity(sprints.map((s) => ({ ...s, report: asSprintReport(s.report) })));
}
