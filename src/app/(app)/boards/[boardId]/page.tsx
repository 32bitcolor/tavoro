import { after } from "next/server";
import { STALE_MS, refreshCardCourses, type CourseState } from "@/lib/courseforge";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getBoardForUser } from "@/lib/authz";
import { BoardView } from "@/components/board/board-view";
import { loadProjectContext } from "@/lib/project-context";
import { asCardType, asPriority } from "@/lib/card-fields";
import { epicProgress } from "@/lib/epics";
import { blockedCardIds } from "@/lib/card-blocked";

export const metadata = { title: "Board · Tavoro" };

export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;

  const board = await getBoardForUser(boardId);
  if (!board) notFound();

  const meta = await prisma.board.findUnique({
    where: { id: boardId },
    select: { publicNonce: true, project: { select: { id: true, name: true } }, workspace: { select: { estimateUnit: true } } },
  });

  const raw = await prisma.column.findMany({
    where: { boardId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      name: true,
      position: true,
      wipLimit: true,
      status: { select: { category: true } },
      cards: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          position: true,
          dueDate: true,
          keySeq: true,
          private: true,
          type: true,
          priority: true,
          estimate: true,
          epic: { select: { id: true, title: true } },
          labels: { select: { label: { select: { id: true, name: true, color: true } } } },
          assignees: { select: { user: { select: { id: true, name: true, email: true } } } },
          smes: { select: { user: { select: { id: true, name: true, email: true } } } },
          subtasks: { select: { done: true } },
          // The deliverable a card produces, with its most recent review round —
          // surfaced on the card face so the board shows where review stands.
          deliverables: {
            take: 1,
            select: {
              name: true,
              reviewCycles: { orderBy: { round: "desc" }, take: 1, select: { round: true, status: true } },
            },
          },
          _count: { select: { comments: true, attachments: true } },
          // Its CourseForge course (docs/SUITE.md, step 2): cached title and state.
          course: { select: { id: true, title: true, summary: true, missing: true, syncedAt: true } },
        },
      },
    },
  });
  // Stale course summaries refresh after this response, so the next look is current.
  const staleCourses = raw.flatMap((c) => c.cards.flatMap((k) => (k.course && Date.now() - k.course.syncedAt.getTime() > STALE_MS ? [k.course.id] : [])));
  if (staleCourses.length) after(() => refreshCardCourses(prisma, { ids: staleCourses }).catch(() => {}));

  // Progress for the epics on this board, shown on their card faces.
  const progress = await epicProgress(raw.flatMap((c) => c.cards.filter((k) => k.type === "epic").map((k) => k.id)));
  const blocked = await blockedCardIds(raw.flatMap((c) => c.cards.map((k) => k.id)));

  const columns = raw.map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position,
    wipLimit: c.wipLimit,
    category: (c.status?.category ?? null) as "todo" | "active" | "done" | null,
    cards: c.cards.map((card) => {
      const d = card.deliverables[0];
      const review = d?.reviewCycles[0];
      return {
        id: card.id,
        title: card.title,
        description: card.description,
        position: card.position,
        dueDate: card.dueDate ? card.dueDate.toISOString() : null,
        keySeq: card.keySeq,
        private: card.private,
        type: asCardType(card.type),
        priority: asPriority(card.priority),
        estimate: card.estimate,
        epic: card.epic,
        epicProgress: progress.get(card.id) ?? null,
        blocked: blocked.has(card.id),
        labels: card.labels.map((l) => l.label),
        assignees: card.assignees.map((a) => a.user),
        smes: card.smes.map((s) => s.user),
        checklist: { total: card.subtasks.length, done: card.subtasks.filter((i) => i.done).length },
        comments: card._count.comments,
        attachments: card._count.attachments,
        deliverable: d ? { name: d.name, review: review ? { round: review.round, status: review.status } : null } : null,
        course: card.course ? { title: card.course.title, state: card.course.missing ? null : (((card.course.summary as { state?: CourseState } | null)?.state ?? null) as CourseState | null) } : null,
      };
    }),
  }));

  const project = meta?.project ?? null;
  const context = project ? await loadProjectContext(project.id) : null;

  return (
    <BoardView
      boardId={boardId}
      boardName={board.name}
      cardKeyPrefix={board.cardKeyPrefix}
      publicShared={!!meta?.publicNonce}
      project={project}
      context={context}
      initialColumns={columns}
      estimateUnit={meta?.workspace.estimateUnit === "hours" ? "hours" : "points"}
    />
  );
}
