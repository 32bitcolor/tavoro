"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { nextCardKeySeq } from "@/lib/card-keys";
import { getActiveMembership, getCurrentUser } from "@/lib/dal";
import { boardVisibilityWhere, getBoardForUser, getColumnForUser, getCardForUser, getProjectForUser } from "@/lib/authz";
import { positionBetween, positionsAfter, positionForIndex } from "@/lib/ordering";
import { pickStatusIdForName } from "@/lib/status";
import { notifyCardStatusChange } from "@/lib/notify";

const Name = z.string().trim().min(1, "Required").max(120);
const Title = z.string().trim().min(1, "Required").max(280);
// Card key prefix, e.g. "WP" -> cards are labeled "WP-1", "WP-2", ...
const CardKeyPrefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,7}$/, "2-8 letters/numbers, starting with a letter");

const DEFAULT_COLUMNS = ["To do", "In progress", "Done"];

function boardPath(boardId: string) {
  return `/boards/${boardId}`;
}

// ── Boards ───────────────────────────────────────────────────────────────────

export async function createBoard(formData: FormData): Promise<void> {
  const prefix = formData.get("cardKeyPrefix");
  const res = await createBoardNamed(String(formData.get("name") ?? ""), typeof prefix === "string" ? prefix : null);
  if (res.board) redirect(boardPath(res.board.id));
  if (res.error === "Not signed in.") redirect("/login");
  // An empty name is a no-op: the input is `required`.
}

/** A standalone board in the active workspace, with the default columns. */
export async function createBoardNamed(name: string, rawPrefix?: string | null) {
  const membership = await getActiveMembership();
  if (!membership) return { error: "Not signed in." };

  const parsed = Name.safeParse(name);
  if (!parsed.success) return { error: "Board name is required." };

  // The prefix is optional — boards created without one just never label cards.
  const prefixParsed = rawPrefix && rawPrefix.trim() ? CardKeyPrefix.safeParse(rawPrefix) : null;
  let cardKeyPrefix: string | null = prefixParsed?.success ? prefixParsed.data : null;
  if (cardKeyPrefix) {
    const taken = await prisma.board.findFirst({
      where: { workspaceId: membership.workspaceId, cardKeyPrefix },
      select: { id: true },
    });
    // Another board already claimed it — the board still gets created, just
    // without a prefix (the board header's prefix editor explains why on retry).
    if (taken) cardKeyPrefix = null;
  }

  const positions = positionsAfter(null, DEFAULT_COLUMNS.length);
  const statuses = await prisma.workspaceStatus.findMany({
    where: { workspaceId: membership.workspaceId },
    select: { id: true, name: true },
  });
  const board = await prisma.board.create({
    data: {
      workspaceId: membership.workspaceId,
      name: parsed.data,
      cardKeyPrefix,
      columns: {
        create: DEFAULT_COLUMNS.map((name, i) => ({
          name,
          position: positions[i],
          statusId: pickStatusIdForName(statuses, name),
        })),
      },
    },
    select: { id: true, name: true, cardKeyPrefix: true },
  });
  revalidatePath("/boards");
  return { board };
}

/** Attach an existing board to a project, or detach it (projectId = null). */
export async function setBoardProject(boardId: string, projectId: string | null) {
  const board = await getBoardForUser(boardId);
  if (!board) return { error: "Board not found." };
  if (projectId) {
    const project = await getProjectForUser(projectId);
    if (!project) return { error: "Project not found." };
    if (project.workspaceId !== board.workspaceId) return { error: "That project is in another workspace." };
  }
  await prisma.board.update({ where: { id: boardId }, data: { projectId } });
  revalidatePath(boardPath(boardId));
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

/** Create a board that belongs to a project (called from the project page).
 *  Returns the new board rather than redirecting, so the caller can link to it. */
export async function createProjectBoard(projectId: string, name: string) {
  const project = await getProjectForUser(projectId);
  if (!project) return { error: "Project not found." };
  const parsed = Name.safeParse(name);
  if (!parsed.success) return { error: "Board name is required." };

  const positions = positionsAfter(null, DEFAULT_COLUMNS.length);
  const statuses = await prisma.workspaceStatus.findMany({
    where: { workspaceId: project.workspaceId },
    select: { id: true, name: true },
  });
  const board = await prisma.board.create({
    data: {
      workspaceId: project.workspaceId,
      projectId,
      name: parsed.data,
      columns: {
        create: DEFAULT_COLUMNS.map((n, i) => ({
          name: n,
          position: positions[i],
          statusId: pickStatusIdForName(statuses, n),
        })),
      },
    },
    select: { id: true, name: true },
  });
  revalidatePath(`/projects/${projectId}`);
  return { board };
}

/** Set or clear a board's card-key prefix (blank clears it — existing card
 * keys are left as-is, only new cards stop getting one). Setting a prefix
 * retroactively assigns keys to any of the board's cards/subtasks that
 * don't have one yet (in creation order), so it isn't just new cards. */
export async function setBoardCardKeyPrefix(boardId: string, prefix: string) {
  const board = await getBoardForUser(boardId);
  if (!board) return { error: "Board not found." };
  if (!prefix.trim()) {
    await prisma.board.update({ where: { id: boardId }, data: { cardKeyPrefix: null } });
    revalidatePath(boardPath(boardId));
    return { cardKeyPrefix: null };
  }
  const parsed = CardKeyPrefix.safeParse(prefix);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid prefix." };

  if (parsed.data !== board.cardKeyPrefix) {
    const taken = await prisma.board.findFirst({
      where: { workspaceId: board.workspaceId, cardKeyPrefix: parsed.data, id: { not: boardId } },
      select: { id: true },
    });
    if (taken) return { error: `"${parsed.data}" is already used by another board in this workspace.` };
  }

  try {
    await prisma.board.update({ where: { id: boardId }, data: { cardKeyPrefix: parsed.data } });
  } catch (e) {
    // Belt-and-suspenders: turn a unique-constraint race into a friendly error
    // instead of a thrown 500 that the client surfaces as a generic failure.
    if ((e as { code?: string })?.code === "P2002") {
      return { error: `"${parsed.data}" is already used by another board in this workspace.` };
    }
    throw e;
  }
  await backfillCardKeys(boardId);
  revalidatePath(boardPath(boardId));
  return { cardKeyPrefix: parsed.data };
}

/** Assign keys to any of a board's cards/subtasks that don't have one yet
 * (creation order), so setting a prefix on a board that already has cards
 * labels them immediately instead of only labeling cards created after. */
async function backfillCardKeys(boardId: string): Promise<number> {
  const cards = await prisma.card.findMany({
    where: {
      keySeq: null,
      OR: [
        { columnId: { not: null }, column: { boardId } },
        { parentCardId: { not: null }, parentCard: { column: { boardId } } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (cards.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    const current = await tx.board.findUniqueOrThrow({ where: { id: boardId }, select: { cardKeySeq: true } });
    let seq = current.cardKeySeq;
    for (const c of cards) {
      seq += 1;
      await tx.card.update({ where: { id: c.id }, data: { keySeq: seq } });
    }
    await tx.board.update({ where: { id: boardId }, data: { cardKeySeq: seq } });
  });
  return cards.length;
}

/** Derive a short, unique-within-workspace card-key prefix from a board's
 * name (e.g. "Course Production Pipeline" -> "CPP"). Shared by the
 * admin-triggered workspace-wide backfill below and prisma/backfill-card-keys.ts. */
function deriveBoardPrefix(name: string, taken: Set<string>): string {
  const words = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  let base: string;
  if (words.length >= 2) {
    base = words
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 6);
  } else {
    base = "";
  }
  if (base.length < 2 || !/^[A-Z]/.test(base)) {
    const word = (words[0] ?? "BOARD").replace(/[^a-zA-Z]/g, "");
    base = (word.slice(0, 4) || "BOARD").toUpperCase().padEnd(2, "X");
  }
  if (!taken.has(base)) return base;
  let n = 2;
  let candidate = `${base}${n}`.slice(0, 8);
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}${n}`.slice(0, 8);
  }
  return candidate;
}

/** Admin: assign an auto-derived, unique-per-workspace prefix to every board
 * in the caller's workspace that doesn't have one yet, and backfill keys onto
 * all of its existing cards/subtasks. Safe to re-run — boards/cards that
 * already have a key are left untouched. */
export async function backfillWorkspaceCardKeys() {
  const membership = await getActiveMembership();
  if (!membership || membership.role !== "ADMIN") return { error: "You must be a workspace admin." };

  const boards = await prisma.board.findMany({
    where: { workspaceId: membership.workspaceId, cardKeyPrefix: null },
    select: { id: true, name: true },
  });
  if (boards.length === 0) return { results: [] as { boardName: string; prefix: string; count: number }[] };

  const existing = await prisma.board.findMany({
    where: { workspaceId: membership.workspaceId, cardKeyPrefix: { not: null } },
    select: { cardKeyPrefix: true },
  });
  const taken = new Set(existing.map((e) => e.cardKeyPrefix!));

  const results: { boardName: string; prefix: string; count: number }[] = [];
  for (const board of boards) {
    const prefix = deriveBoardPrefix(board.name, taken);
    taken.add(prefix);
    await prisma.board.update({ where: { id: board.id }, data: { cardKeyPrefix: prefix } });
    const count = await backfillCardKeys(board.id);
    results.push({ boardName: board.name, prefix, count });
    revalidatePath(boardPath(board.id));
  }
  revalidatePath("/boards");
  return { results };
}

export async function renameBoard(boardId: string, name: string) {
  const board = await getBoardForUser(boardId);
  if (!board) return { error: "Board not found." };
  const parsed = Name.safeParse(name);
  if (!parsed.success) return { error: "Board name is required." };
  await prisma.board.update({ where: { id: boardId }, data: { name: parsed.data } });
  revalidatePath(boardPath(boardId));
  revalidatePath("/boards");
}

export async function deleteBoard(boardId: string) {
  const board = await getBoardForUser(boardId);
  if (!board) return { error: "Board not found." };
  await prisma.board.delete({ where: { id: boardId } });
  redirect("/boards");
}

// ── Columns ──────────────────────────────────────────────────────────────────

export async function createColumn(boardId: string, name: string) {
  const board = await getBoardForUser(boardId);
  if (!board) return { error: "Board not found." };
  const parsed = Name.safeParse(name);
  if (!parsed.success) return { error: "Column name is required." };

  const [last, statuses] = await Promise.all([
    prisma.column.findFirst({
      where: { boardId },
      orderBy: { position: "desc" },
      select: { position: true },
    }),
    prisma.workspaceStatus.findMany({
      where: { workspaceId: board.workspaceId },
      select: { id: true, name: true },
    }),
  ]);
  const column = await prisma.column.create({
    data: {
      boardId,
      name: parsed.data,
      statusId: pickStatusIdForName(statuses, parsed.data),
      position: positionBetween(last?.position ?? null, null),
    },
    select: { id: true, name: true, position: true },
  });
  revalidatePath(boardPath(boardId));
  return { column };
}

export async function renameColumn(columnId: string, name: string) {
  const column = await getColumnForUser(columnId);
  if (!column) return { error: "Column not found." };
  const parsed = Name.safeParse(name);
  if (!parsed.success) return { error: "Column name is required." };
  await prisma.column.update({ where: { id: columnId }, data: { name: parsed.data } });
  revalidatePath(boardPath(column.boardId));
}

export async function deleteColumn(columnId: string) {
  const column = await getColumnForUser(columnId);
  if (!column) return { error: "Column not found." };
  await prisma.column.delete({ where: { id: columnId } });
  revalidatePath(boardPath(column.boardId));
}

export async function moveColumn(columnId: string, targetIndex: number) {
  const column = await getColumnForUser(columnId);
  if (!column) return { error: "Column not found." };

  const siblings = await prisma.column.findMany({
    where: { boardId: column.boardId, id: { not: columnId } },
    orderBy: { position: "asc" },
    select: { position: true },
  });
  const position = positionForIndex(siblings.map((c) => c.position), targetIndex);
  await prisma.column.update({ where: { id: columnId }, data: { position } });
  revalidatePath(boardPath(column.boardId));
}

// ── Cards ────────────────────────────────────────────────────────────────────

export async function createCard(columnId: string, title: string) {
  const column = await getColumnForUser(columnId);
  if (!column) return { error: "Column not found." };
  const parsed = Title.safeParse(title);
  if (!parsed.success) return { error: "Card title is required." };

  const last = await prisma.card.findFirst({
    where: { columnId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const keySeq = await nextCardKeySeq(column.boardId);
  const card = await prisma.card.create({
    data: {
      columnId,
      title: parsed.data,
      keySeq,
      statusId: column.statusId, // inherit the column's canonical status
      position: positionBetween(last?.position ?? null, null),
    },
    select: { id: true, columnId: true, title: true, description: true, position: true, keySeq: true },
  });
  revalidatePath(boardPath(column.boardId));
  return { card };
}

export async function renameCard(cardId: string, title: string) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };
  const parsed = Title.safeParse(title);
  if (!parsed.success) return { error: "Card title is required." };
  await prisma.card.update({ where: { id: cardId }, data: { title: parsed.data } });
  revalidatePath(boardPath(card.boardId));
}

export async function deleteCard(cardId: string) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };
  await prisma.card.delete({ where: { id: cardId } });
  revalidatePath(boardPath(card.boardId));
}

/** Set a card's canonical status (used by the cross-project sprint board). If the
 *  card's home board has a column mapped to that status, move the card there too so
 *  both views stay coherent. */
export async function setCardStatus(cardId: string, statusId: string) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };
  const board = await prisma.board.findUnique({ where: { id: card.boardId }, select: { workspaceId: true } });
  if (!board) return { error: "Board not found." };
  const status = await prisma.workspaceStatus.findFirst({
    where: { id: statusId, workspaceId: board.workspaceId },
    select: { id: true, name: true },
  });
  if (!status) return { error: "Status not found." };
  const before = await prisma.card.findUnique({ where: { id: cardId }, select: { statusId: true } });

  const data: { statusId: string; columnId?: string; position?: string } = { statusId };
  const col = await prisma.column.findFirst({
    where: { boardId: card.boardId, statusId },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (col && card.columnId) {
    const last = await prisma.card.findFirst({
      where: { columnId: col.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    data.columnId = col.id;
    data.position = positionBetween(last?.position ?? null, null);
  }
  await prisma.card.update({ where: { id: cardId }, data });
  revalidatePath(boardPath(card.boardId));

  if (before?.statusId !== statusId) {
    const actor = await getCurrentUser();
    await notifyCardStatusChange({
      cardId,
      boardId: card.boardId,
      workspaceId: board.workspaceId,
      statusName: status.name,
      actor: actor ? { id: actor.id, name: actor.name, email: actor.email } : null,
    });
  }
  return { ok: true };
}

/** Move a card to `toColumnId` at `targetIndex` (index among the OTHER cards there). */
/** Boards (with their columns) a card can be moved to: every other board in its
 *  workspace that this member can see. */
export async function listMoveTargets(cardId: string) {
  const card = await getCardForUser(cardId);
  if (!card || card.parentCardId) return [];
  const from = await prisma.board.findUnique({ where: { id: card.boardId }, select: { workspaceId: true } });
  if (!from) return [];
  const boards = await prisma.board.findMany({
    where: { workspaceId: from.workspaceId, id: { not: card.boardId }, ...(await boardVisibilityWhere()) },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      cardKeyPrefix: true,
      project: { select: { name: true } },
      columns: { orderBy: { position: "asc" }, select: { id: true, name: true, statusId: true } },
    },
  });
  return boards
    .filter((b) => b.columns.length > 0)
    .map((b) => ({ id: b.id, name: b.name, cardKeyPrefix: b.cardKeyPrefix, projectName: b.project?.name ?? null, columns: b.columns }));
}

/** Move a card (with its subtasks, comments, attachments and everything else) to a
 *  column on another board in the same workspace, at the bottom. Its key changes to
 *  the new board's (SEC-12 → OPS-31); the old key keeps resolving to it through a
 *  CardKeyAlias. It takes the column's status, and leaves its sprint if the new board
 *  doesn't do sprints. */
export async function moveCardToBoard(cardId: string, toColumnId: string) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };
  if (card.parentCardId) return { error: "Subtasks move with their card. Move the card instead." };
  const target = await getColumnForUser(toColumnId);
  if (!target) return { error: "Target column not found." };
  if (target.boardId === card.boardId) return { error: "The card is already on that board." };

  const [fromBoard, toBoard, current] = await Promise.all([
    prisma.board.findUnique({ where: { id: card.boardId }, select: { workspaceId: true } }),
    prisma.board.findUnique({
      where: { id: target.boardId },
      select: { workspaceId: true, name: true, cardKeyPrefix: true, project: { select: { sprintsEnabled: true } } },
    }),
    prisma.card.findUnique({
      where: { id: cardId },
      select: { keySeq: true, statusId: true, sprintId: true, subtasks: { orderBy: { position: "asc" }, select: { id: true, keySeq: true } } },
    }),
  ]);
  if (!fromBoard || !toBoard || !current) return { error: "Card not found." };
  if (fromBoard.workspaceId !== toBoard.workspaceId) return { error: "Cards can only move between boards in the same workspace." };

  const last = await prisma.card.findFirst({ where: { columnId: toColumnId }, orderBy: { position: "desc" }, select: { position: true } });
  const sprintsAllowed = !toBoard.project || toBoard.project.sprintsEnabled;
  const moving = [{ id: cardId, keySeq: current.keySeq }, ...current.subtasks];

  const newKeySeq = await prisma.$transaction(async (tx) => {
    // Keep the old keys findable.
    const aliases = moving.filter((c) => c.keySeq != null).map((c) => ({ boardId: card.boardId, keySeq: c.keySeq!, cardId: c.id }));
    if (aliases.length) await tx.cardKeyAlias.createMany({ data: aliases, skipDuplicates: true });

    // New keys from the target board's sequence, one per card and subtask, in order.
    let firstSeq: number | null = null;
    if (toBoard.cardKeyPrefix) {
      const updated = await tx.board.update({
        where: { id: target.boardId },
        data: { cardKeySeq: { increment: moving.length } },
        select: { cardKeySeq: true },
      });
      firstSeq = updated.cardKeySeq - moving.length + 1;
    }
    for (const [i, c] of moving.entries()) {
      await tx.card.update({
        where: { id: c.id },
        data: {
          keySeq: firstSeq != null ? firstSeq + i : null,
          ...(c.id === cardId
            ? {
                columnId: toColumnId,
                position: positionBetween(last?.position ?? null, null),
                statusId: target.statusId,
                ...(sprintsAllowed ? {} : { sprintId: null }),
              }
            : {}),
        },
      });
    }
    // If this key had been an alias for something (the card moved away and back), the
    // card now owns it again.
    if (firstSeq != null) {
      await tx.cardKeyAlias.deleteMany({
        where: { boardId: target.boardId, keySeq: { gte: firstSeq, lt: firstSeq + moving.length } },
      });
    }
    return firstSeq;
  });

  revalidatePath(boardPath(card.boardId));
  revalidatePath(boardPath(target.boardId));
  revalidatePath("/sprints", "layout");

  if (target.statusId && current.statusId !== target.statusId) {
    const status = await prisma.workspaceStatus.findUnique({ where: { id: target.statusId }, select: { name: true } });
    if (status) {
      const actor = await getCurrentUser();
      await notifyCardStatusChange({
        cardId,
        boardId: target.boardId,
        workspaceId: toBoard.workspaceId,
        statusName: status.name,
        actor: actor ? { id: actor.id, name: actor.name, email: actor.email } : null,
      });
    }
  }

  return {
    boardId: target.boardId,
    boardName: toBoard.name,
    key: toBoard.cardKeyPrefix && newKeySeq != null ? `${toBoard.cardKeyPrefix}-${newKeySeq}` : null,
    leftSprint: !sprintsAllowed && current.sprintId != null,
  };
}

export async function moveCard(cardId: string, toColumnId: string, targetIndex: number) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };
  const target = await getColumnForUser(toColumnId);
  if (!target) return { error: "Target column not found." };
  if (target.boardId !== card.boardId) return { error: "Cross-board move not allowed." };

  const siblings = await prisma.card.findMany({
    where: { columnId: toColumnId, id: { not: cardId } },
    orderBy: { position: "asc" },
    select: { position: true },
  });
  const position = positionForIndex(siblings.map((c) => c.position), targetIndex);
  const before = await prisma.card.findUnique({ where: { id: cardId }, select: { statusId: true } });
  // Keep the card's canonical status in sync with the column it lands in.
  await prisma.card.update({
    where: { id: cardId },
    data: { columnId: toColumnId, position, statusId: target.statusId },
  });
  revalidatePath(boardPath(card.boardId));

  // Notify assignees/SMEs only when the canonical status actually changed (a
  // reorder, or a move between two columns mapped to the same status, doesn't).
  if (target.statusId && before?.statusId !== target.statusId) {
    const status = await prisma.workspaceStatus.findUnique({
      where: { id: target.statusId },
      select: { name: true, workspaceId: true },
    });
    if (status) {
      const actor = await getCurrentUser();
      await notifyCardStatusChange({
        cardId,
        boardId: card.boardId,
        workspaceId: status.workspaceId,
        statusName: status.name,
        actor: actor ? { id: actor.id, name: actor.name, email: actor.email } : null,
      });
    }
  }
}
