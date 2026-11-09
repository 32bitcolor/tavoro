import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { boardVisibilityWhere } from "@/lib/authz";
import { SprintBoard } from "@/components/sprint/sprint-board";
import { asCardType, asPriority } from "@/lib/card-fields";
import { blockedCardIds } from "@/lib/card-blocked";

export const metadata = { title: "Sprint board · Tavoro" };

export default async function SprintBoardPage({ params }: { params: Promise<{ sprintId: string }> }) {
  const { sprintId } = await params;
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const wsId = membership.workspaceId;

  const sprint = await prisma.sprint.findFirst({
    where: { id: sprintId, workspaceId: wsId },
    select: { id: true, name: true, goal: true, status: true, startDate: true, endDate: true },
  });
  if (!sprint) notFound();

  const [statuses, cards, workspace] = await Promise.all([
    prisma.workspaceStatus.findMany({
      where: { workspaceId: wsId },
      orderBy: { position: "asc" },
      select: { id: true, name: true, category: true },
    }),
    // Top-level cards in this sprint whose home board the user can see (respects
    // group visibility). Standalone-board cards are included — they just have no project.
    prisma.card.findMany({
      where: {
        sprintId,
        columnId: { not: null },
        column: { board: { workspaceId: wsId, ...(await boardVisibilityWhere()) } },
      },
      orderBy: { updatedAt: "desc" },
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
        smes: { select: { user: { select: { id: true, name: true, email: true } } } },
        labels: { select: { label: { select: { id: true, name: true, color: true } } } },
        column: {
          select: {
            board: {
              select: {
                id: true,
                cardKeyPrefix: true,
                project: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    }),
    prisma.workspace.findUnique({ where: { id: wsId }, select: { estimateUnit: true } }),
  ]);

  const blocked = await blockedCardIds(cards.map((c) => c.id));
  const items = cards.map((c) => ({
    id: c.id,
    title: c.title,
    keySeq: c.keySeq,
    statusId: c.statusId,
    dueDate: c.dueDate ? c.dueDate.toISOString() : null,
    type: asCardType(c.type),
    priority: asPriority(c.priority),
    estimate: c.estimate,
    epic: c.epic,
    blocked: blocked.has(c.id),
    boardId: c.column!.board.id,
    cardKeyPrefix: c.column!.board.cardKeyPrefix,
    project: c.column!.board.project,
    assignees: c.assignees.map((a) => a.user),
    smes: c.smes.map((s) => s.user),
    labels: c.labels.map((l) => l.label),
  }));

  const progress = sprintProgress(sprint);

  return (
    <SprintBoard
      sprint={{
        ...sprint,
        progress,
        startDate: sprint.startDate ? sprint.startDate.toISOString() : null,
        endDate: sprint.endDate ? sprint.endDate.toISOString() : null,
      }}
      statuses={statuses.map((s) => ({ ...s, category: s.category as "todo" | "active" | "done" }))}
      initialCards={items}
      estimateUnit={workspace?.estimateUnit === "hours" ? "hours" : "points"}
    />
  );
}

/** "day N of M" for an active sprint with dates; null otherwise. */
function sprintProgress(sprint: { status: string; startDate: Date | null; endDate: Date | null }): string | null {
  if (sprint.status !== "active" || !sprint.startDate || !sprint.endDate) return null;
  const day = 86_400_000;
  const total = Math.max(1, Math.round((sprint.endDate.getTime() - sprint.startDate.getTime()) / day) + 1);
  const elapsed = Math.min(total, Math.max(1, Math.floor((Date.now() - sprint.startDate.getTime()) / day) + 1));
  return `day ${elapsed} of ${total}`;
}
