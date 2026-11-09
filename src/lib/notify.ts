import "server-only";

import { prisma } from "@/lib/db";
import { enqueueEmail } from "@/lib/queues";
import { appUrl } from "@/lib/app-url";
import { statusChanged, subtaskStatusChanged, watchedCardChanged, withLink } from "@/lib/email-templates";
import { watchersOf } from "@/lib/card-activity";
import { notificationEnabled, type NotificationType } from "@/lib/notifications";

type Actor = { id: string; name: string | null; email: string } | null;

/**
 * Whether a workspace has a notification type enabled. Call this once to gate an
 * entire notify block (rather than per-recipient) so triggers stay to one query.
 */
export async function notificationsEnabled(workspaceId: string, type: NotificationType): Promise<boolean> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { notificationSettings: true },
  });
  return notificationEnabled(ws?.notificationSettings, type);
}

function actorName(actor: Actor): string {
  return actor?.name ?? actor?.email ?? "Someone";
}

/** A top-level card moved to a new status → tell its assignees and SMEs (not the mover). */
export async function notifyCardStatusChange(opts: {
  cardId: string;
  boardId: string;
  workspaceId: string;
  statusName: string;
  actor: Actor;
}): Promise<void> {
  if (!(await notificationsEnabled(opts.workspaceId, "status_change"))) return;

  const card = await prisma.card.findUnique({
    where: { id: opts.cardId },
    select: {
      title: true,
      column: { select: { board: { select: { name: true } } } },
      assignees: { select: { user: { select: { id: true, name: true, email: true } } } },
      smes: { select: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
  if (!card) return;

  const boardName = card.column?.board.name ?? "";
  const link = appUrl(`/boards/${opts.boardId}?card=${opts.cardId}`);
  const seen = new Set<string>(opts.actor ? [opts.actor.id] : []);

  const watchers = (await watchersOf(opts.cardId, opts.workspaceId)).map((user) => ({ user }));
  for (const { user } of [...card.assignees, ...card.smes, ...watchers]) {
    if (seen.has(user.id) || !user.email) continue;
    seen.add(user.id);
    await enqueueEmail({
      to: user.email,
      ...withLink(
        statusChanged({
          recipientName: user.name ?? user.email,
          actorName: actorName(opts.actor),
          cardTitle: card.title,
          boardName,
          statusName: opts.statusName,
        }),
        link,
      ),
    });
  }
}

/** A subtask was completed or reopened → tell its assignees and the parent card's assignees/SMEs. */
export async function notifySubtaskStatusChange(opts: {
  subtaskId: string;
  parentCardId: string;
  boardId: string;
  workspaceId: string;
  done: boolean;
  actor: Actor;
}): Promise<void> {
  if (!(await notificationsEnabled(opts.workspaceId, "status_change"))) return;

  const sub = await prisma.card.findUnique({
    where: { id: opts.subtaskId },
    select: {
      title: true,
      assignees: { select: { user: { select: { id: true, name: true, email: true } } } },
      parentCard: {
        select: {
          title: true,
          column: { select: { board: { select: { name: true } } } },
          assignees: { select: { user: { select: { id: true, name: true, email: true } } } },
          smes: { select: { user: { select: { id: true, name: true, email: true } } } },
        },
      },
    },
  });
  if (!sub?.parentCard) return;

  const cardTitle = sub.parentCard.title;
  const boardName = sub.parentCard.column?.board.name ?? "";
  const link = appUrl(`/boards/${opts.boardId}?card=${opts.parentCardId}`);
  const seen = new Set<string>(opts.actor ? [opts.actor.id] : []);

  const recipients = [...sub.assignees, ...sub.parentCard.assignees, ...sub.parentCard.smes];
  for (const { user } of recipients) {
    if (seen.has(user.id) || !user.email) continue;
    seen.add(user.id);
    await enqueueEmail({
      to: user.email,
      ...withLink(
        subtaskStatusChanged({
          recipientName: user.name ?? user.email,
          actorName: actorName(opts.actor),
          subtaskText: sub.title,
          cardTitle,
          boardName,
          done: opts.done,
        }),
        link,
      ),
    });
  }
}

/** Tell a card's watchers about a change (assignee, priority), except the person who made
 *  it and anyone in `except` (already told some other way). */
export async function notifyWatchers(opts: {
  cardId: string;
  boardId: string;
  workspaceId: string;
  actor: Actor;
  change: string;
  except?: string[];
}): Promise<void> {
  if (!(await notificationsEnabled(opts.workspaceId, "watching"))) return;
  const card = await prisma.card.findUnique({
    where: { id: opts.cardId },
    select: { title: true, column: { select: { board: { select: { name: true } } } }, parentCard: { select: { column: { select: { board: { select: { name: true } } } } } } },
  });
  if (!card) return;
  const boardName = card.column?.board.name ?? card.parentCard?.column?.board.name ?? "";
  const link = appUrl(`/boards/${opts.boardId}?card=${opts.cardId}`);
  const skip = [...(opts.except ?? []), ...(opts.actor ? [opts.actor.id] : [])];
  for (const user of await watchersOf(opts.cardId, opts.workspaceId, skip)) {
    if (!user.email) continue;
    await enqueueEmail({
      to: user.email,
      ...withLink(watchedCardChanged({ recipientName: user.name ?? user.email, actorName: actorName(opts.actor), cardTitle: card.title, boardName, change: opts.change }), link),
    });
  }
}
