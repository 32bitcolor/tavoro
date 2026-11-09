import "server-only";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { prisma } from "@/lib/db";
import { boardVisibilityWhere } from "@/lib/authz";
import { asCardType, asPriority, type CardType, type Priority } from "@/lib/card-fields";
import { blockedCardIds } from "@/lib/card-blocked";
import { asSprintReport, type SprintReport } from "@/lib/sprint";

// The Backlog (docs/JIRA-PARITY.md): active and planned sprints, then every open card
// with no sprint, all in one cross-board order. That order is Card.rank, a fractional
// index used only here. Cards without a rank sort after ranked ones, oldest first, and
// get one the first time someone ranks around them (ensureRanks).

export const RANK_ORDER = [{ rank: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }] as const;

export const BACKLOG_CARD_SELECT = {
  id: true,
  title: true,
  keySeq: true,
  statusId: true,
  dueDate: true,
  type: true,
  priority: true,
  estimate: true,
  sprintId: true,
  status: { select: { category: true } },
  epic: { select: { id: true, title: true } },
  assignees: { select: { user: { select: { id: true, name: true, email: true } } } },
  labels: { select: { label: { select: { id: true, name: true, color: true } } } },
  column: { select: { board: { select: { id: true, name: true, cardKeyPrefix: true, project: { select: { id: true, name: true } } } } } },
} as const;

type Person = { id: string; name: string | null; email: string };
export type BacklogCard = {
  id: string;
  title: string;
  keySeq: number | null;
  statusId: string | null;
  done: boolean;
  dueDate: string | null;
  type: CardType;
  priority: Priority | null;
  estimate: number | null;
  sprintId: string | null;
  epic: { id: string; title: string } | null;
  blocked: boolean;
  boardId: string;
  boardName: string;
  cardKeyPrefix: string | null;
  project: { id: string; name: string } | null;
  assignees: Person[];
  labels: { id: string; name: string; color: string }[];
};

export type BacklogSprint = {
  id: string;
  name: string;
  goal: string | null;
  status: "planned" | "active";
  startDate: string | null;
  endDate: string | null;
  report: SprintReport;
};

/** The most cards the backlog section shows; the rest are counted. */
export const BACKLOG_LIMIT = 1500;

type Row = {
  id: string;
  title: string;
  keySeq: number | null;
  statusId: string | null;
  dueDate: Date | null;
  type: string;
  priority: string | null;
  estimate: number | null;
  sprintId: string | null;
  status: { category: string } | null;
  epic: { id: string; title: string } | null;
  assignees: { user: Person }[];
  labels: { label: { id: string; name: string; color: string } }[];
  column: { board: { id: string; name: string; cardKeyPrefix: string | null; project: { id: string; name: string } | null } } | null;
};

function toCard(c: Row, blocked: Set<string>): BacklogCard {
  return {
    id: c.id,
    title: c.title,
    keySeq: c.keySeq,
    statusId: c.statusId,
    done: c.status?.category === "done",
    dueDate: c.dueDate ? c.dueDate.toISOString() : null,
    type: asCardType(c.type),
    priority: asPriority(c.priority),
    estimate: c.estimate,
    sprintId: c.sprintId,
    epic: c.epic,
    blocked: blocked.has(c.id),
    boardId: c.column!.board.id,
    boardName: c.column!.board.name,
    cardKeyPrefix: c.column!.board.cardKeyPrefix,
    project: c.column!.board.project,
    assignees: c.assignees.map((a) => a.user),
    labels: c.labels.map((l) => l.label),
  };
}

/** Everything the Backlog page shows, for the caller's active workspace. */
export async function loadBacklog(workspaceId: string) {
  const sprints = await prisma.sprint.findMany({
    where: { workspaceId, status: { in: ["active", "planned"] } },
    // Active first (earliest start first), then planned in the order they were made.
    orderBy: [{ status: "asc" }, { startDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    select: { id: true, name: true, goal: true, status: true, startDate: true, endDate: true, report: true },
  });
  const visible = { workspaceId, ...(await boardVisibilityWhere()) };
  const base = { columnId: { not: null }, type: { not: "epic" }, column: { board: visible } };
  const [inSprints, backlog, backlogTotal] = await Promise.all([
    prisma.card.findMany({
      where: { ...base, sprintId: { in: sprints.map((s) => s.id) } },
      orderBy: [...RANK_ORDER],
      select: BACKLOG_CARD_SELECT,
    }),
    prisma.card.findMany({
      where: { ...base, sprintId: null, OR: [{ statusId: null }, { status: { category: { not: "done" } } }] },
      orderBy: [...RANK_ORDER],
      take: BACKLOG_LIMIT,
      select: BACKLOG_CARD_SELECT,
    }),
    prisma.card.count({ where: { ...base, sprintId: null, OR: [{ statusId: null }, { status: { category: { not: "done" } } }] } }),
  ]);
  const blocked = await blockedCardIds([...inSprints, ...backlog].map((c) => c.id));
  return {
    // "active" sorts before "planned", which is the order we want.
    sprints: sprints.map<BacklogSprint>((s) => ({
      id: s.id,
      name: s.name,
      goal: s.goal,
      status: s.status === "active" ? "active" : "planned",
      startDate: s.startDate ? s.startDate.toISOString().slice(0, 10) : null,
      endDate: s.endDate ? s.endDate.toISOString().slice(0, 10) : null,
      report: asSprintReport(s.report),
    })),
    cards: [...inSprints, ...backlog].map((c) => toCard(c as Row, blocked)),
    hiddenBacklog: Math.max(0, backlogTotal - backlog.length),
  };
}

/** Give every unranked top-level card in the workspace a rank after the last ranked
 *  one, oldest first — the order they already show in, so nothing visibly moves. */
export async function ensureRanks(workspaceId: string) {
  const where = { columnId: { not: null }, column: { board: { workspaceId } } };
  const [last, unranked] = await Promise.all([
    prisma.card.findFirst({ where: { ...where, rank: { not: null } }, orderBy: { rank: "desc" }, select: { rank: true } }),
    prisma.card.findMany({ where: { ...where, rank: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } }),
  ]);
  if (unranked.length === 0) return;
  const keys = generateNKeysBetween(last?.rank ?? null, null, unranked.length);
  for (let i = 0; i < unranked.length; i += 500) {
    const ids = unranked.slice(i, i + 500).map((c) => c.id);
    const ranks = keys.slice(i, i + 500);
    await prisma.$executeRaw`UPDATE "Card" AS c SET "rank" = v.rank FROM unnest(${ids}::text[], ${ranks}::text[]) AS v(id, rank) WHERE c.id = v.id AND c."rank" IS NULL`;
  }
}

/** A rank between two cards' ranks (either null = that end of the list). */
export function rankBetween(before: string | null, after: string | null): string {
  // Two cards ranked at once can, rarely, tie; place after `before` rather than fail.
  if (before && after && before >= after) return generateKeyBetween(before, null);
  return generateKeyBetween(before, after);
}
