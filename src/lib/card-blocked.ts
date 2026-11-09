import "server-only";

import { prisma } from "@/lib/db";

/** Which of these cards are blocked by an unfinished card — for the "Blocked" mark. */
export async function blockedCardIds(cardIds: string[]): Promise<Set<string>> {
  if (cardIds.length === 0) return new Set();
  const rows = await prisma.cardLink.findMany({
    where: { type: "blocks", toId: { in: cardIds }, from: { NOT: { status: { category: "done" } } } },
    select: { toId: true, from: { select: { parentCardId: true, done: true } } },
  });
  // A blocking subtask that's ticked done no longer blocks.
  return new Set(rows.filter((r) => !(r.from.parentCardId && r.from.done)).map((r) => r.toId));
}
