"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser, getWorkspaceAdmin } from "@/lib/dal";
import { getBoardForUser, getCardForUser } from "@/lib/authz";
import { currentPrincipal } from "@/lib/principal";
import { newShareNonce, shareUrl } from "@/lib/board-share";

// Public, read-only board links (lib/board-share.ts). Anyone who can work on a board
// can share it, but only from the browser: an AI assistant connected over MCP can't
// publish a board to the internet. Admins can switch links off for the whole
// workspace in Settings → Sharing, and turn off any board's link there.

export type BoardShareState = {
  allowed: boolean;
  url: string | null;
  showAssignees: boolean;
  sharedAt: string | null;
  sharedBy: string | null;
};

async function shareable(boardId: string) {
  if (currentPrincipal()) return null;
  return getBoardForUser(boardId);
}

async function state(boardId: string): Promise<BoardShareState> {
  const b = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      id: true,
      publicNonce: true,
      publicShowAssignees: true,
      publicSharedAt: true,
      publicSharedBy: { select: { name: true, email: true } },
      workspace: { select: { publicBoardsEnabled: true } },
    },
  });
  return {
    allowed: b?.workspace.publicBoardsEnabled ?? false,
    url: b?.publicNonce ? shareUrl({ id: b.id, publicNonce: b.publicNonce }) : null,
    showAssignees: b?.publicShowAssignees ?? false,
    sharedAt: b?.publicSharedAt?.toISOString() ?? null,
    sharedBy: b?.publicSharedBy ? (b.publicSharedBy.name ?? b.publicSharedBy.email) : null,
  };
}

function touched(boardId: string) {
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings/sharing");
}

export async function getBoardShare(boardId: string) {
  const board = await getBoardForUser(boardId);
  if (!board) return { error: "Board not found." };
  return state(boardId);
}

/** Turn the public link on (a fresh link), or reset it (a new link; the old one stops working). */
export async function shareBoard(boardId: string) {
  const board = await shareable(boardId);
  if (!board) return { error: "Board not found." };
  const ws = await prisma.workspace.findUnique({ where: { id: board.workspaceId }, select: { publicBoardsEnabled: true } });
  if (!ws?.publicBoardsEnabled) return { error: "An admin has turned off public board links for this workspace." };
  const me = await getCurrentUser();
  await prisma.board.update({
    where: { id: boardId },
    data: { publicNonce: newShareNonce(), publicSharedAt: new Date(), publicSharedById: me?.id ?? null },
  });
  touched(boardId);
  return state(boardId);
}

export async function unshareBoard(boardId: string) {
  const board = await shareable(boardId);
  if (!board) return { error: "Board not found." };
  await prisma.board.update({
    where: { id: boardId },
    data: { publicNonce: null, publicSharedAt: null, publicSharedById: null },
  });
  touched(boardId);
  return state(boardId);
}

export async function setBoardShareAssignees(boardId: string, show: boolean) {
  const board = await shareable(boardId);
  if (!board) return { error: "Board not found." };
  await prisma.board.update({ where: { id: boardId }, data: { publicShowAssignees: show } });
  touched(boardId);
  return state(boardId);
}

/** Private cards never appear on the board's public link. Allowed over MCP too:
 *  hiding a card only ever shows less. */
export async function setCardPrivate(cardId: string, isPrivate: boolean) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };
  if (card.parentCardId) return { error: "Subtasks follow their card; make the card private instead." };
  await prisma.card.update({ where: { id: cardId }, data: { private: isPrivate } });
  revalidatePath(`/boards/${card.boardId}`);
  return { ok: true as const };
}

// ── Settings → Sharing (admins) ──────────────────────────────────────────────


export async function setPublicBoardsEnabled(enabled: boolean) {
  const m = await getWorkspaceAdmin();
  if (!m) return { error: "Only admins can change this." };
  await prisma.workspace.update({ where: { id: m.workspaceId }, data: { publicBoardsEnabled: enabled } });
  revalidatePath("/settings/sharing");
  return { ok: true as const };
}

export async function adminUnshareBoard(boardId: string) {
  const m = await getWorkspaceAdmin();
  if (!m) return { error: "Only admins can change this." };
  await prisma.board.updateMany({
    where: { id: boardId, workspaceId: m.workspaceId },
    data: { publicNonce: null, publicSharedAt: null, publicSharedById: null },
  });
  touched(boardId);
  return { ok: true as const };
}
