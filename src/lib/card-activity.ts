import "server-only";

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ActivityData, ActivityKind } from "@/lib/card-activity-text";

// Writes a card's History (docs/JIRA-PARITY.md) and keeps its watchers. Every server
// action that changes a card calls recordActivity, so the UI and MCP are recorded alike.

type Db = typeof prisma | Prisma.TransactionClient;

/** Description edits autosave; record one entry per person per 10 minutes. */
const DESCRIPTION_QUIET_MS = 10 * 60 * 1000;

export async function recordActivity(cardId: string, actorId: string | null | undefined, kind: ActivityKind, data: ActivityData = {}, db: Db = prisma) {
  if (kind === "description" && actorId) {
    const recent = await db.cardActivity.findFirst({
      where: { cardId, actorId, kind, createdAt: { gt: new Date(Date.now() - DESCRIPTION_QUIET_MS) } },
      select: { id: true },
    });
    if (recent) return;
  }
  await db.cardActivity.create({ data: { cardId, actorId: actorId ?? null, kind, data: data as Prisma.InputJsonValue } });
}

/** Add watchers (ignoring ones already watching). */
export async function watch(cardId: string, userIds: (string | null | undefined)[], db: Db = prisma) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  await db.cardWatcher.createMany({ data: ids.map((userId) => ({ cardId, userId })), skipDuplicates: true });
}

/** Watchers of a card (members still active in its workspace), minus some ids. */
export async function watchersOf(cardId: string, workspaceId: string, except: Iterable<string> = []) {
  const skip = new Set(except);
  const rows = await prisma.cardWatcher.findMany({
    where: { cardId, user: { memberships: { some: { workspaceId, suspendedAt: null } } } },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  return rows.map((r) => r.user).filter((u) => !skip.has(u.id));
}
