"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveMembership, getCurrentUser } from "@/lib/dal";
import { getCardForUser } from "@/lib/authz";
import { withEmailDigest } from "@/lib/queues";
import { runQuery } from "@/lib/query/run";
import { assignCardToSprint } from "@/app/actions/sprints";
import { setCardEpic } from "@/app/actions/epics";
import { deleteCard, moveCardToBoard, setCardStatus } from "@/app/actions/boards";
import { setCardEstimate, setCardPriority, setCardType, setWatching, toggleCardAssignee, toggleCardLabel } from "@/app/actions/cards";

// The Cards page (docs/JIRA-PARITY.md, phase 7): run a query, and change many cards at
// once. A bulk change goes card by card through the same actions a single edit uses —
// same permission checks, same History entries — with each person's emails rolled
// into one digest.

export async function searchCards(query: string, page = 0) {
  const m = await getActiveMembership();
  if (!m) return { ok: false as const, error: "Sign in again.", pos: 0, end: 0 };
  return runQuery(m.workspaceId, m.userId, query.slice(0, 2000), Math.max(0, Math.floor(page)), 50);
}

const BULK_LIMIT = 1000;

const Change = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), statusId: z.string().min(1) }),
  z.object({ kind: z.literal("assignee"), userId: z.string().min(1), add: z.boolean() }),
  z.object({ kind: z.literal("priority"), priority: z.string().nullable() }),
  z.object({ kind: z.literal("type"), type: z.string() }),
  z.object({ kind: z.literal("estimate"), estimate: z.number().min(0).max(10000).nullable() }),
  z.object({ kind: z.literal("sprint"), sprintId: z.string().nullable() }),
  z.object({ kind: z.literal("epic"), epicId: z.string().nullable() }),
  z.object({ kind: z.literal("label"), labelId: z.string().min(1), add: z.boolean() }),
  z.object({ kind: z.literal("watch"), on: z.boolean() }),
  z.object({ kind: z.literal("board"), boardId: z.string().min(1) }),
  z.object({ kind: z.literal("delete") }),
]);
export type BulkChange = z.infer<typeof Change>;

type Result = { error?: string } | { ok?: true } | undefined | null | void | Record<string, unknown>;
const failed = (r: Result) => !!r && typeof r === "object" && "error" in r && typeof r.error === "string" && !!r.error;

/** Apply one change to up to 1,000 cards. Cards the caller can't change are skipped and listed. */
export async function bulkUpdateCards(cardIds: string[], change: BulkChange) {
  const m = await getActiveMembership();
  if (!m) return { error: "Sign in again." };
  const parsed = Change.safeParse(change);
  if (!parsed.success) return { error: "That change isn’t valid." };
  const ids = [...new Set(cardIds)].slice(0, BULK_LIMIT);
  if (!ids.length) return { error: "Select some cards first." };
  const c = parsed.data;

  // Moving to a board needs its first column; resolve it once.
  let toColumnId: string | null = null;
  if (c.kind === "board") {
    const col = await prisma.column.findFirst({ where: { boardId: c.boardId, board: { workspaceId: m.workspaceId } }, orderBy: { position: "asc" }, select: { id: true } });
    if (!col) return { error: "That board has no columns." };
    toColumnId = col.id;
  }

  const me = await getCurrentUser();
  const results: { id: string; error?: string }[] = [];
  await withEmailDigest(me?.name ?? me?.email ?? "Someone", async () => {
    for (const id of ids) {
      if (!(await getCardForUser(id))) {
        results.push({ id, error: "Card not found." });
        continue;
      }
      let r: Result;
      try {
        switch (c.kind) {
          case "status":
            r = await setCardStatus(id, c.statusId);
            break;
          case "assignee":
            r = await toggleCardAssignee(id, c.userId, c.add);
            break;
          case "priority":
            r = await setCardPriority(id, c.priority);
            break;
          case "type":
            r = await setCardType(id, c.type);
            break;
          case "estimate":
            r = await setCardEstimate(id, c.estimate);
            break;
          case "sprint":
            r = await assignCardToSprint(id, c.sprintId);
            break;
          case "epic":
            r = await setCardEpic(id, c.epicId);
            break;
          case "label":
            r = await toggleCardLabel(id, c.labelId, c.add);
            break;
          case "watch":
            r = await setWatching(id, c.on);
            break;
          case "board":
            r = await moveCardToBoard(id, toColumnId!);
            break;
          case "delete":
            r = await deleteCard(id);
            break;
        }
      } catch (e) {
        r = { error: (e as Error).message };
      }
      results.push(failed(r) ? { id, error: (r as { error: string }).error } : { id });
    }
  });
  revalidatePath("/cards");
  const errors = results.filter((x) => x.error);
  // Name the cards that failed, with the reason, so the person can act on them.
  const keyed = errors.length
    ? await prisma.card.findMany({ where: { id: { in: errors.map((e) => e.id) } }, select: { id: true, title: true, keySeq: true, column: { select: { board: { select: { cardKeyPrefix: true } } } } } })
    : [];
  const name = (id: string) => {
    const k = keyed.find((x) => x.id === id);
    return k ? (k.column?.board.cardKeyPrefix && k.keySeq != null ? `${k.column.board.cardKeyPrefix}-${k.keySeq}` : k.title) : "A card";
  };
  return { updated: results.length - errors.length, failed: errors.map((e) => ({ id: e.id, card: name(e.id), error: e.error! })) };
}
