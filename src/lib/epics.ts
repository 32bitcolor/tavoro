import "server-only";

import { prisma } from "@/lib/db";
import { boardVisibilityWhere } from "@/lib/authz";
import { getActiveMembership } from "@/lib/dal";

async function getAccessWorkspaceId() {
  return (await getActiveMembership())?.workspaceId ?? null;
}

// Epics (docs/JIRA-PARITY.md): an epic is a Card with type "epic". Other top-level
// cards on any board in the workspace point at it through Card.epicId. Its progress
// is computed from its cards' statuses; there's no separate epic status.

export type EpicRef = { id: string; title: string; key: string | null; boardId: string };
export type EpicProgress = { total: number; done: number };

const keyOf = (prefix: string | null | undefined, seq: number | null) => (prefix && seq != null ? `${prefix}-${seq}` : null);

/** Cards a viewer may see, as a Card where-clause (top-level cards only). */
async function visibleCards(workspaceId: string) {
  return { columnId: { not: null }, column: { board: { workspaceId, ...(await boardVisibilityWhere()) } } } as const;
}

/** done / total for each epic, counting every card in it (including ones on boards the
 *  viewer can't see — the number is about the epic, not the viewer). */
export async function epicProgress(epicIds: string[]): Promise<Map<string, EpicProgress>> {
  const out = new Map<string, EpicProgress>(epicIds.map((id) => [id, { total: 0, done: 0 }]));
  if (epicIds.length === 0) return out;
  const rows = await prisma.card.findMany({
    where: { epicId: { in: epicIds } },
    select: { epicId: true, status: { select: { category: true } } },
  });
  for (const r of rows) {
    const p = out.get(r.epicId!)!;
    p.total++;
    if (r.status?.category === "done") p.done++;
  }
  return out;
}

/** The epics the viewer can pick from, newest first, with their progress. */
export async function listEpics(opts: { includeDone?: boolean } = {}) {
  const workspaceId = await getAccessWorkspaceId();
  if (!workspaceId) return [];
  const rows = await prisma.card.findMany({
    where: {
      type: "epic",
      ...(await visibleCards(workspaceId)),
      ...(opts.includeDone ? {} : { NOT: { status: { category: "done" } } }),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      title: true,
      keySeq: true,
      status: { select: { name: true, category: true } },
      column: { select: { board: { select: { id: true, name: true, cardKeyPrefix: true } } } },
    },
  });
  const progress = await epicProgress(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    key: keyOf(r.column!.board.cardKeyPrefix, r.keySeq),
    boardId: r.column!.board.id,
    boardName: r.column!.board.name,
    status: r.status?.name ?? null,
    done: r.status?.category === "done",
    progress: progress.get(r.id)!,
  }));
}

/** An epic's cards the viewer can see, plus how many more sit on boards they can't. */
export async function epicChildren(epicId: string) {
  const workspaceId = await getAccessWorkspaceId();
  if (!workspaceId) return { cards: [], hidden: 0, progress: { total: 0, done: 0 } };
  const [cards, total, progress] = await Promise.all([
    prisma.card.findMany({
      where: { epicId, ...(await visibleCards(workspaceId)) },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        keySeq: true,
        type: true,
        priority: true,
        estimate: true,
        status: { select: { name: true, category: true } },
        assignees: { select: { user: { select: { id: true, name: true, email: true } } } },
        column: { select: { board: { select: { id: true, name: true, cardKeyPrefix: true } } } },
      },
    }),
    prisma.card.count({ where: { epicId } }),
    epicProgress([epicId]),
  ]);
  return {
    cards: cards.map((c) => ({
      id: c.id,
      title: c.title,
      key: keyOf(c.column!.board.cardKeyPrefix, c.keySeq),
      type: c.type,
      priority: c.priority,
      estimate: c.estimate,
      status: c.status?.name ?? null,
      done: c.status?.category === "done",
      boardId: c.column!.board.id,
      boardName: c.column!.board.name,
      assignees: c.assignees.map((a) => a.user),
    })),
    hidden: total - cards.length,
    progress: progress.get(epicId)!,
  };
}

/** Top-level, non-epic cards the viewer can see that could join this epic — for the
 *  epic's "Add cards" picker. Matches title or key ("SEC-12"). */
export async function epicCandidates(epicId: string, query: string) {
  const workspaceId = await getAccessWorkspaceId();
  if (!workspaceId) return [];
  const q = query.trim();
  const keyMatch = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d+)$/.exec(q);
  const rows = await prisma.card.findMany({
    where: {
      ...(await visibleCards(workspaceId)),
      type: { not: "epic" },
      OR: [{ epicId: null }, { epicId: { not: epicId } }],
      ...(keyMatch
        ? { keySeq: Number(keyMatch[2]), column: { board: { workspaceId, cardKeyPrefix: { equals: keyMatch[1], mode: "insensitive" }, ...(await boardVisibilityWhere()) } } }
        : q
          ? { title: { contains: q, mode: "insensitive" } }
          : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      title: true,
      keySeq: true,
      type: true,
      epic: { select: { title: true } },
      column: { select: { board: { select: { name: true, cardKeyPrefix: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    key: keyOf(r.column!.board.cardKeyPrefix, r.keySeq),
    type: r.type,
    boardName: r.column!.board.name,
    currentEpic: r.epic?.title ?? null,
  }));
}

/** The epic a card belongs to, for its face and drawer. */
export function epicRefOf(epic: { id: string; title: string; keySeq: number | null; column: { board: { id: string; cardKeyPrefix: string | null } } | null } | null): EpicRef | null {
  if (!epic || !epic.column) return null;
  return { id: epic.id, title: epic.title, key: keyOf(epic.column.board.cardKeyPrefix, epic.keySeq), boardId: epic.column.board.id };
}

/** Select clause for epicRefOf. */
export const EPIC_REF_SELECT = {
  select: { id: true, title: true, keySeq: true, column: { select: { board: { select: { id: true, cardKeyPrefix: true } } } } },
} as const;
