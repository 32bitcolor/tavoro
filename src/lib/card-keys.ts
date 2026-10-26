import "server-only";
import { prisma } from "@/lib/db";

// Not a server action: it trusts its caller to have checked access to the board.

/** Claim the next card key number for a board, or null if it has no prefix
 * set (checked first so boards without a prefix never burn through the
 * sequence — otherwise adding a prefix later would start mid-way instead of
 * at 1). The increment itself is a single atomic UPDATE, safe under
 * concurrent card creation. Shared by top-level cards and subtasks alike. */
export async function nextCardKeySeq(boardId: string): Promise<number | null> {
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { cardKeyPrefix: true } });
  if (!board?.cardKeyPrefix) return null;
  const updated = await prisma.board.update({
    where: { id: boardId },
    data: { cardKeySeq: { increment: 1 } },
    select: { cardKeySeq: true },
  });
  return updated.cardKeySeq;
}
