// Ticks made in Tavoro go back to CourseForge (docs/SUITE.md, step 4). A reviewer comment's
// subtask is done when the comment is resolved; ticking it here resolves the comment there.
// Not "server-only": the worker retries failed pushes with it.
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { call, type AppRef } from "./courseforge";
import type { CommentState } from "./suite-reviews";

type Db = PrismaClient | Prisma.TransactionClient;
const APP = {
  id: true,
  url: true,
  clientId: true,
  secretSealed: true,
} as const;

async function push(app: AppRef, externalId: string, resolved: boolean) {
  await call(app, "/api/suite/review-comments", {
    method: "POST",
    body: JSON.stringify({ comment: externalId, resolved }),
  });
}

/**
 * A subtask was ticked or unticked here. If it is a CourseForge reviewer's comment, tell CourseForge.
 * The item is marked pending first, so a sync from CourseForge can't undo the tick while the message
 * is on its way (or if CourseForge is down: the worker tries again).
 */
export async function pushSubtaskDone(
  db: Db,
  subtaskId: string,
  done: boolean,
): Promise<void> {
  const item = await db.suiteItem.findFirst({
    where: { cardId: subtaskId, kind: "review-comment" },
    select: { id: true, externalId: true, state: true, app: { select: APP } },
  });
  if (!item) return;
  const st = (item.state ?? {}) as unknown as CommentState;
  if (st.resolved === done && !st.pending) return; // already how CourseForge has it
  const next: CommentState = {
    ...st,
    resolved: done,
    pending: true,
    resolvedAt: done ? new Date().toISOString() : null,
  };
  await db.suiteItem.update({
    where: { id: item.id },
    data: { state: next as unknown as Prisma.InputJsonValue },
  });
  try {
    await push(item.app, item.externalId, done);
    await db.suiteItem.update({
      where: { id: item.id },
      data: {
        state: { ...next, pending: false } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    console.error(
      "[suite] couldn't tell CourseForge:",
      e instanceof Error ? e.message : e,
    );
  }
}

/** Try again for ticks that haven't reached CourseForge. */
export async function retryPendingPushes(db: Db): Promise<number> {
  const rows = await db.suiteItem.findMany({
    where: {
      kind: "review-comment",
      cardId: { not: null },
      state: { path: ["pending"], equals: true },
    },
    select: { id: true, externalId: true, state: true, app: { select: APP } },
    take: 100,
  });
  let n = 0;
  for (const r of rows) {
    const st = r.state as unknown as CommentState;
    try {
      await push(r.app, r.externalId, st.resolved);
      await db.suiteItem.update({
        where: { id: r.id },
        data: {
          state: { ...st, pending: false } as unknown as Prisma.InputJsonValue,
        },
      });
      n++;
    } catch {
      /* still unreachable: next time */
    }
  }
  return n;
}
