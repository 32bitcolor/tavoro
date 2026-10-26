"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/dal";
import { boardVisibilityWhere, getColumnForUser, getDeliverableForUser, getReviewCommentForUser } from "@/lib/authz";
import { nextCardKeySeq } from "@/lib/card-keys";
import { positionBetween } from "@/lib/ordering";
import { parseAnchor } from "@/lib/review-anchor";
import { parseSnapshot } from "@/lib/review-snapshot";
import { memberName, type CardRef } from "@/lib/review-comments";
import {
  cardDescriptionForChecklist,
  cardDescriptionForComment,
  describePlace,
  excerpt,
  feedbackPath,
  pinNumbers,
  type CommentForCard,
} from "@/lib/review-feedback";

// Feedback → work (docs/REVIEW-LINKS.md, phase 4, locked decision 8): open review
// comments become board cards, one per comment or one card with a subtask each, and
// each comment keeps a link to its card. Members only — nothing here takes a guest.

export type LinkedComment = { commentId: string; card: CardRef };

export type BoardTarget = { id: string; name: string; inProject: boolean; columns: { id: string; name: string }[] };

/** Boards a deliverable's feedback can go to: the project's own boards first, then
 *  every other board the member can see in the workspace. The default is the board of
 *  the card the deliverable is linked to, if any, else the project's first board. */
export async function listBoardTargets(deliverableId: string) {
  const d = await getDeliverableForUser(deliverableId);
  if (!d) return { error: "Deliverable not found." };
  const deliverable = await prisma.deliverable.findUnique({
    where: { id: deliverableId },
    select: {
      project: { select: { id: true, workspaceId: true } },
      card: { select: { column: { select: { boardId: true } }, parentCard: { select: { column: { select: { boardId: true } } } } } },
    },
  });
  if (!deliverable) return { error: "Deliverable not found." };
  const boards = await prisma.board.findMany({
    where: { workspaceId: deliverable.project.workspaceId, ...(await boardVisibilityWhere()) },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      projectId: true,
      columns: { orderBy: { position: "asc" }, select: { id: true, name: true } },
    },
  });
  const targets: BoardTarget[] = boards
    .filter((b) => b.columns.length > 0)
    .map((b) => ({ id: b.id, name: b.name, inProject: b.projectId === deliverable.project.id, columns: b.columns }))
    .sort((a, b) => Number(b.inProject) - Number(a.inProject));
  const linked = deliverable.card?.column?.boardId ?? deliverable.card?.parentCard?.column?.boardId;
  const defaultBoardId = targets.find((t) => t.id === linked)?.id ?? targets[0]?.id ?? null;
  return { boards: targets, defaultBoardId };
}

const SendInput = z.object({
  commentIds: z.array(z.string().min(1)).min(1, "Pick at least one comment.").max(100, "Send at most 100 comments at a time."),
  columnId: z.string().min(1),
  mode: z.enum(["each", "checklist"]),
  title: z.string().trim().max(280).optional(),
});
export type SendToBoardInput = z.input<typeof SendInput>;

/** Turn review comments into work on a board. Comments already sent are skipped, so
 *  pressing the button twice never makes two cards. */
export async function sendCommentsToBoard(input: SendToBoardInput) {
  const me = await getCurrentUser();
  if (!me) return { error: "Not signed in." };
  const parsed = SendInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { commentIds, columnId, mode } = parsed.data;

  const column = await getColumnForUser(columnId);
  if (!column) return { error: "That board column is gone — pick another." };
  const board = await prisma.board.findUnique({ where: { id: column.boardId }, select: { workspaceId: true, cardKeyPrefix: true } });
  if (!board) return { error: "Board not found." };

  // Every comment must be one the member can see, and a thread's first comment.
  for (const id of new Set(commentIds)) {
    const c = await getReviewCommentForUser(id);
    if (!c) return { error: "One of those comments no longer exists." };
    if (c.parentId) return { error: "Send a thread's first comment, not a reply." };
  }
  const rows = await prisma.reviewComment.findMany({
    where: { id: { in: commentIds } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      anchor: true,
      cardId: true,
      roundId: true,
      author: { select: { name: true, email: true } },
      guest: { select: { name: true } },
      round: {
        select: {
          number: true,
          snapshot: true,
          file: { select: { mimeType: true } },
          deliverable: { select: { id: true, name: true, projectId: true, project: { select: { workspaceId: true } } } },
        },
      },
    },
  });
  const deliverable = rows[0]?.round.deliverable;
  if (!deliverable) return { error: "Those comments no longer exist." };
  if (rows.some((r) => r.round.deliverable.id !== deliverable.id)) {
    return { error: "Send one deliverable's comments at a time." };
  }
  if (deliverable.project.workspaceId !== board.workspaceId) {
    return { error: "That board is in another workspace." };
  }
  const todo = rows.filter((r) => !r.cardId);
  if (todo.length === 0) return { created: 0, skipped: rows.length, card: null, linked: [] as LinkedComment[] };

  // Pin numbers count every file-anchored thread in a round, sent or not.
  const roundIds = [...new Set(todo.map((r) => r.roundId))];
  const roundThreads = await prisma.reviewComment.findMany({
    where: { roundId: { in: roundIds }, parentId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, roundId: true, anchor: true },
  });
  const pins = new Map<string, number>();
  for (const roundId of roundIds) {
    const threads = roundThreads.filter((t) => t.roundId === roundId).map((t) => ({ id: t.id, anchor: parseAnchor(t.anchor) }));
    for (const [id, n] of pinNumbers(threads)) pins.set(id, n);
  }

  const comments: CommentForCard[] = todo.map((r) => {
    const anchor = parseAnchor(r.anchor);
    return {
      id: r.id,
      roundId: r.roundId,
      roundNumber: r.round.number,
      body: r.body,
      anchor,
      place: describePlace(anchor, {
        snapshot: parseSnapshot(r.round.snapshot),
        isPdf: r.round.file?.mimeType === "application/pdf",
        pinNumber: pins.get(r.id),
      }),
      author: r.author ? memberName(r.author, "member") : r.guest ? `${r.guest.name} (guest)` : "Former reviewer",
    };
  });

  const last = await prisma.card.findFirst({ where: { columnId }, orderBy: { position: "desc" }, select: { position: true } });
  let position = last?.position ?? null;
  async function newCard(title: string, description: string) {
    position = positionBetween(position, null);
    return prisma.card.create({
      data: {
        columnId,
        title,
        description,
        keySeq: await nextCardKeySeq(column!.boardId),
        statusId: column!.statusId,
        position,
      },
      select: { id: true, keySeq: true },
    });
  }
  const linked: LinkedComment[] = [];
  const ref = (card: { id: string; keySeq: number | null }): CardRef => ({
    id: card.id,
    boardId: column.boardId,
    key: board.cardKeyPrefix && card.keySeq != null ? `${board.cardKeyPrefix}-${card.keySeq}` : null,
    done: false,
  });

  let first: { id: string } | null = null;
  if (mode === "each") {
    for (const c of comments) {
      const card = await newCard(excerpt(c.body, 120) || c.place, cardDescriptionForComment(c, deliverable.name));
      await prisma.reviewComment.update({ where: { id: c.id }, data: { cardId: card.id } });
      linked.push({ commentId: c.id, card: ref(card) });
      first ??= card;
    }
  } else {
    const rounds = [...new Set(comments.map((c) => c.roundNumber))].sort((a, b) => a - b);
    const title =
      parsed.data.title ||
      `Review feedback: ${deliverable.name}${rounds.length === 1 ? ` (round ${rounds[0]})` : ""}`;
    const parent = await newCard(title.slice(0, 280), cardDescriptionForChecklist(comments.length, deliverable, rounds));
    first = parent;
    let subPos: string | null = null;
    for (const c of comments) {
      subPos = positionBetween(subPos, null);
      const item = await prisma.card.create({
        data: {
          parentCardId: parent.id,
          title: `${c.place}: ${excerpt(c.body, 200)}`.slice(0, 280),
          description: cardDescriptionForComment(c, deliverable.name),
          keySeq: await nextCardKeySeq(column.boardId),
          position: subPos,
        },
        select: { id: true, keySeq: true },
      });
      await prisma.reviewComment.update({ where: { id: c.id }, data: { cardId: item.id } });
      linked.push({ commentId: c.id, card: ref(item) });
    }
  }

  revalidatePath(`/boards/${column.boardId}`);
  for (const roundId of roundIds) revalidatePath(`/reviews/${roundId}`);
  revalidatePath(feedbackPath(deliverable.id));
  return {
    created: comments.length,
    skipped: rows.length - comments.length,
    card: first ? { id: first.id, boardId: column.boardId } : null,
    linked,
  };
}

/** Resolve, won't-fix or reopen several threads at once, with one shared note. */
export async function setReviewCommentsStatus(commentIds: string[], status: string, note?: string | null) {
  const me = await getCurrentUser();
  if (!me) return { error: "Not signed in." };
  const ids = z.array(z.string().min(1)).min(1).max(200).safeParse(commentIds);
  const st = z.enum(["open", "resolved", "wont_fix"]).safeParse(status);
  if (!ids.success || !st.success) return { error: "Invalid request." };

  const roundIds = new Set<string>();
  for (const id of new Set(ids.data)) {
    const c = await getReviewCommentForUser(id);
    if (!c) return { error: "One of those comments no longer exists." };
    if (c.parentId) return { error: "Only a thread's first comment has a status." };
    roundIds.add(c.roundId);
  }
  const closing = st.data !== "open";
  await prisma.reviewComment.updateMany({
    where: { id: { in: ids.data } },
    data: {
      status: st.data,
      resolvedById: closing ? me.id : null,
      resolvedAt: closing ? new Date() : null,
      resolvedNote: closing ? (note?.trim() ? note.trim().slice(0, 1000) : null) : null,
    },
  });
  const rounds = await prisma.reviewRound.findMany({ where: { id: { in: [...roundIds] } }, select: { id: true, deliverableId: true } });
  for (const r of rounds) {
    revalidatePath(`/reviews/${r.id}`);
    revalidatePath(feedbackPath(r.deliverableId));
  }
  return { updated: ids.data.length };
}
