"use server";

import { recordActivity } from "@/lib/card-activity";
import { getCurrentUser } from "@/lib/dal";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCardForUser } from "@/lib/authz";
import { epicCandidates, epicChildren, listEpics } from "@/lib/epics";

// Epics (docs/JIRA-PARITY.md). Rules, enforced here for the UI and MCP alike:
// - the epic must be a card with type "epic" the caller can see, in the same workspace;
// - only top-level cards that aren't epics themselves can be in an epic;
// - a subtask follows its parent, so it has no epic of its own.

async function workspaceOfBoard(boardId: string) {
  return (await prisma.board.findUnique({ where: { id: boardId }, select: { workspaceId: true } }))?.workspaceId ?? null;
}

/** Put a card in an epic, or take it out (epicId null). */
export async function setCardEpic(cardId: string, epicId: string | null) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };
  if (card.parentCardId) return { error: "A subtask belongs to its card’s epic, not one of its own." };
  const row = await prisma.card.findUnique({ where: { id: cardId }, select: { type: true, epicId: true, epic: { select: { title: true } } } });
  if (row?.type === "epic") return { error: "An epic can’t be in another epic." };

  let epic: { id: string; title: string; boardId: string } | null = null;
  if (epicId) {
    if (epicId === cardId) return { error: "A card can’t be its own epic." };
    const access = await getCardForUser(epicId);
    if (!access || access.parentCardId) return { error: "Epic not found." };
    const target = await prisma.card.findUnique({ where: { id: epicId }, select: { type: true, title: true } });
    if (target?.type !== "epic") return { error: "That card isn’t an epic." };
    if ((await workspaceOfBoard(access.boardId)) !== (await workspaceOfBoard(card.boardId))) return { error: "Epic not found." };
    epic = { id: epicId, title: target.title, boardId: access.boardId };
  }

  await prisma.card.update({ where: { id: cardId }, data: { epicId } });
  if ((row?.epicId ?? null) !== epicId) {
    await recordActivity(cardId, (await getCurrentUser())?.id, "epic", { from: row?.epic?.title ?? null, to: epic?.title ?? null });
  }
  revalidatePath(`/boards/${card.boardId}`);
  if (epic && epic.boardId !== card.boardId) revalidatePath(`/boards/${epic.boardId}`);
  if (row?.epicId) {
    const old = await getCardForUser(row.epicId);
    if (old) revalidatePath(`/boards/${old.boardId}`);
  }
  revalidatePath("/sprints");
  return { epic: epic ? { id: epic.id, title: epic.title } : null };
}

/** Add several cards to an epic at once (the epic's "Add cards" picker). */
export async function addCardsToEpic(epicId: string, cardIds: string[]) {
  const added: string[] = [];
  const errors: string[] = [];
  for (const id of cardIds.slice(0, 50)) {
    const res = await setCardEpic(id, epicId);
    if ("error" in res) errors.push(res.error!);
    else added.push(id);
  }
  return { added, errors };
}

/** The epic picker on a card: open epics the caller can see. */
export async function listEpicOptions() {
  return { epics: await listEpics() };
}

/** An epic's own panel: its cards and progress. */
export async function getEpicCards(epicId: string) {
  const access = await getCardForUser(epicId);
  if (!access) return { error: "Epic not found." };
  return epicChildren(epicId);
}

export async function searchEpicCandidates(epicId: string, query: string) {
  const access = await getCardForUser(epicId);
  if (!access) return { cards: [] };
  return { cards: await epicCandidates(epicId, query.slice(0, 100)) };
}
