import "server-only";
import { prisma } from "@/lib/db";
import { boardVisibilityWhere } from "@/lib/authz";
import { epicProgress } from "@/lib/epics";

// The roadmap (docs/JIRA-PARITY.md, phase 6): epics on a timeline, start to due.

export type RoadmapEpic = {
  id: string;
  key: string | null;
  title: string;
  boardId: string;
  boardName: string;
  status: string | null;
  done: boolean;
  startDate: string | null; // YYYY-MM-DD
  dueDate: string | null;
  progress: { done: number; total: number };
};

export async function loadRoadmap(workspaceId: string): Promise<RoadmapEpic[]> {
  const rows = await prisma.card.findMany({
    where: { type: "epic", columnId: { not: null }, column: { board: { workspaceId, ...(await boardVisibilityWhere()) } } },
    orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 500,
    select: {
      id: true,
      title: true,
      keySeq: true,
      startDate: true,
      dueDate: true,
      status: { select: { name: true, category: true } },
      column: { select: { board: { select: { id: true, name: true, cardKeyPrefix: true } } } },
    },
  });
  const progress = await epicProgress(rows.map((r) => r.id));
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  return rows.map((r) => ({
    id: r.id,
    key: r.column!.board.cardKeyPrefix && r.keySeq != null ? `${r.column!.board.cardKeyPrefix}-${r.keySeq}` : null,
    title: r.title,
    boardId: r.column!.board.id,
    boardName: r.column!.board.name,
    status: r.status?.name ?? null,
    done: r.status?.category === "done",
    startDate: day(r.startDate),
    dueDate: day(r.dueDate),
    progress: progress.get(r.id) ?? { done: 0, total: 0 },
  }));
}
