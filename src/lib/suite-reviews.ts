import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { recordActivity, watch } from "@/lib/card-activity";
import { nextCardKeySeq } from "@/lib/card-keys";
import { positionBetween } from "@/lib/ordering";
import { notifyWatchers } from "@/lib/notify";
import { enqueueAutomation } from "@/lib/queues";
import { baseUrl } from "@/lib/oauth";
import { fromCourseForge } from "@/lib/comment-source";

// CourseForge reviews → Tavoro (docs/SUITE.md, step 4). One card per review link, in the
// board of the card its course is linked to; each reviewer's comment is a subtask of it,
// done when the comment is resolved. CourseForge sends a review's whole state whenever
// anything changes, so this is idempotent: repeats and retries do no harm.

export interface ReviewComment {
  id: string;
  author: string;
  text: string;
  /** Where in the course, e.g. "Lesson 2: Welcome · text: Click the button". */
  where?: string;
  url?: string;
  resolved: boolean;
  /** When the comment was made / resolved, so reports can measure turnaround. */
  createdAt?: string;
  resolvedAt?: string | null;
  /** The reviewers' replies in this thread. */
  replies?: { id: string; author: string; text: string; createdAt?: string }[];
}

/** What a comment's SuiteItem remembers (SuiteItem.state). */
export interface CommentState {
  resolved: boolean;
  /** Someone ticked it here and CourseForge doesn't know yet: this side wins until it does. */
  pending?: boolean;
  author?: string;
  commentAt?: string;
  resolvedAt?: string | null;
}

export interface ReviewPayload {
  id: string;
  title: string;
  course: { id: string; title: string; url: string };
  /** The Tavoro member who made the link (their `sub`), if they signed in with Tavoro. */
  createdBy?: string | null;
  createdByName?: string | null;
  expiresAt?: string | null;
  comments: ReviewComment[];
}

type App = { id: string; workspaceId: string; name: string };

export type ReviewResult =
  | {
      card: { id: string; key: string | null; title: string; url: string };
      subtasks: { created: number; updated: number };
    }
  | { card: null; reason: "no_linked_card" | "deleted" };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

// TipTap documents, as Tavoro stores them.
const text = (t: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const link = (t: string, href: string) => text(t, [{ type: "link", attrs: { href } }]);
const para = (...c: ReturnType<typeof text>[]) => ({
  type: "paragraph",
  content: c,
});
const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });

const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);

function isUnique(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

async function cardView(cardId: string, base: string) {
  const c = await prisma.card.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      title: true,
      keySeq: true,
      column: {
        select: { board: { select: { id: true, cardKeyPrefix: true } } },
      },
    },
  });
  if (!c) return null;
  const b = c.column?.board;
  return {
    id: c.id,
    title: c.title,
    key: b?.cardKeyPrefix && c.keySeq != null ? `${b.cardKeyPrefix}-${c.keySeq}` : null,
    url: b ? `${base}/boards/${b.id}?card=${c.id}` : base,
  };
}

export async function syncReview(app: App, r: ReviewPayload, req: Request): Promise<ReviewResult> {
  const base = baseUrl(req);
  let item = await prisma.suiteItem.findUnique({
    where: {
      appId_kind_externalId: {
        appId: app.id,
        kind: "review",
        externalId: r.id,
      },
    },
  });
  if (item && !item.cardId) return { card: null, reason: "deleted" };

  const creator = r.createdBy
    ? await prisma.membership
        .findFirst({
          where: {
            workspaceId: app.workspaceId,
            userId: r.createdBy,
            suspendedAt: null,
          },
          select: { user: { select: { id: true, name: true, email: true } } },
        })
        .then((m) => m?.user ?? null)
    : null;

  if (!item) {
    // Where it goes: the board of the (earliest) card this course is linked to.
    const parent = await prisma.cardCourse.findFirst({
      where: {
        appId: app.id,
        courseId: r.course.id,
        card: { column: { isNot: null } },
      },
      orderBy: { createdAt: "asc" },
      select: {
        card: {
          select: {
            id: true,
            title: true,
            keySeq: true,
            column: {
              select: {
                boardId: true,
                board: { select: { cardKeyPrefix: true } },
              },
            },
          },
        },
      },
    });
    const parentCard = parent?.card;
    const boardId = parentCard?.column?.boardId;
    if (!parentCard || !boardId) return { card: null, reason: "no_linked_card" };
    const column = await prisma.column.findFirst({
      where: { boardId },
      orderBy: { position: "asc" },
      select: { id: true, statusId: true },
    });
    if (!column) return { card: null, reason: "no_linked_card" };

    const parentKey = parentCard.column?.board.cardKeyPrefix && parentCard.keySeq != null ? `${parentCard.column.board.cardKeyPrefix}-${parentCard.keySeq}` : null;
    const description = doc(
      para(text("Reviewers are commenting on "), safeUrl(r.course.url) ? link(r.course.title, r.course.url) : text(r.course.title), text(" in "), text(app.name), text(".")),
      para(text("Each comment is a subtask below. It is ticked off when the comment is resolved in "), text(`${app.name}.`)),
      ...(parentKey ? [para(text(`Course card: ${parentKey} ${parentCard.title}`))] : []),
    );
    const last = await prisma.card.findFirst({
      where: { columnId: column.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const keySeq = await nextCardKeySeq(boardId);
    const card = await prisma.card.create({
      data: {
        columnId: column.id,
        title: clip(`Review: ${oneLine(r.title)}`, 280),
        description,
        keySeq,
        statusId: column.statusId,
        position: positionBetween(last?.position ?? null, null),
        dueDate: r.expiresAt ? new Date(r.expiresAt) : null,
      },
      select: { id: true },
    });
    try {
      item = await prisma.suiteItem.create({
        data: {
          appId: app.id,
          kind: "review",
          externalId: r.id,
          cardId: card.id,
        },
      });
    } catch (e) {
      // A parallel sync made the card first; drop ours and use theirs.
      if (!isUnique(e)) throw e;
      await prisma.card.delete({ where: { id: card.id } });
      item = await prisma.suiteItem.findUnique({
        where: {
          appId_kind_externalId: {
            appId: app.id,
            kind: "review",
            externalId: r.id,
          },
        },
      });
      if (!item?.cardId) return { card: null, reason: "deleted" };
    }
    if (item.cardId === card.id) {
      await prisma.cardCourse.create({
        data: {
          cardId: card.id,
          appId: app.id,
          courseId: r.course.id,
          title: r.course.title,
          linkedById: creator?.id ?? null,
        },
      });
      if (creator) {
        await prisma.cardAssignee.create({ data: { cardId: card.id, userId: creator.id } }).catch(() => {});
        await watch(card.id, [creator.id]);
      }
      await recordActivity(card.id, creator?.id ?? null, "created");
      await prisma.cardLink
        .create({
          data: {
            fromId: card.id,
            toId: parentCard.id,
            type: "relates",
            createdById: creator?.id ?? null,
          },
        })
        .catch(() => {});
    }
  }

  const cardId = item.cardId!;
  const board = await prisma.card.findUnique({
    where: { id: cardId },
    select: { column: { select: { boardId: true } } },
  });
  const boardId = board?.column?.boardId;
  if (!boardId) return { card: null, reason: "deleted" };

  let created = 0;
  let updated = 0;
  // Replies are posted as comments by someone: the person who made the link, else whoever connected the app, else an admin.
  let poster: string | null | undefined;
  const replyAuthor = async () => {
    if (poster !== undefined) return poster;
    const connected = await prisma.connectedApp.findUnique({
      where: { id: app.id },
      select: { createdById: true },
    });
    const admin = await prisma.membership.findFirst({
      where: { workspaceId: app.workspaceId, role: "ADMIN", suspendedAt: null },
      select: { userId: true },
    });
    return (poster = creator?.id ?? connected?.createdById ?? admin?.userId ?? null);
  };
  const now = () => new Date().toISOString();

  for (const c of r.comments) {
    const key = {
      appId_kind_externalId: {
        appId: app.id,
        kind: "review-comment",
        externalId: c.id,
      },
    };
    const existing = await prisma.suiteItem.findUnique({ where: key });
    let subId: string | null = null;
    const boardForSub = boardId;
    if (existing) {
      subId = existing.cardId; // null: someone deleted that subtask here
      if (subId) {
        const st = (existing.state ?? {}) as unknown as CommentState;
        // While a tick made here is on its way to CourseForge, this side wins. Otherwise only a change on
        // the CourseForge side moves it, so ticking one here isn't undone by a sync.
        if (!st.pending && st.resolved !== c.resolved) {
          const sub = await prisma.card.update({
            where: { id: subId },
            data: { done: c.resolved },
            select: { parentCardId: true },
          });
          const next: CommentState = {
            ...st,
            resolved: c.resolved,
            resolvedAt: c.resolved ? (c.resolvedAt ?? now()) : null,
          };
          await prisma.suiteItem.update({
            where: { id: existing.id },
            data: { state: next as unknown as Prisma.InputJsonValue },
          });
          if (c.resolved && sub.parentCardId)
            await enqueueAutomation({
              cardId: sub.parentCardId,
              trigger: "subtasks_done",
              depth: 0,
            });
          updated++;
        } else if (!st.author || !st.commentAt) {
          // Made before these were recorded: fill them in so reports can use it.
          const next: CommentState = {
            ...st,
            author: st.author ?? (oneLine(c.author) || "A reviewer"),
            commentAt: st.commentAt ?? c.createdAt ?? existing.createdAt.toISOString(),
          };
          await prisma.suiteItem.update({
            where: { id: existing.id },
            data: { state: next as unknown as Prisma.InputJsonValue },
          });
        }
      }
    } else {
      const author = oneLine(c.author) || "A reviewer";
      const title = clip(`${author}: ${oneLine(c.text)}`, 280);
      const parts = [
        para(text(author), text(" wrote:")),
        ...c.text
          .split(/\n{1,}/)
          .filter((l) => l.trim())
          .map((l) => para(text(l.trim()))),
      ];
      if (c.where) parts.push(para(text(`On ${oneLine(c.where)}`)));
      if (safeUrl(c.url)) parts.push(para(link(`Open the comment in ${app.name}`, c.url!)));
      const last = await prisma.card.findFirst({
        where: { parentCardId: cardId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const keySeq = await nextCardKeySeq(boardId);
      const sub = await prisma.card.create({
        data: {
          parentCardId: cardId,
          title,
          description: doc(...parts),
          keySeq,
          done: c.resolved,
          position: positionBetween(last?.position ?? null, null),
        },
        select: { id: true },
      });
      const state: CommentState = {
        resolved: c.resolved,
        author,
        commentAt: c.createdAt ?? now(),
        resolvedAt: c.resolved ? (c.resolvedAt ?? now()) : null,
      };
      try {
        await prisma.suiteItem.create({
          data: {
            appId: app.id,
            kind: "review-comment",
            externalId: c.id,
            cardId: sub.id,
            state: state as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        if (!isUnique(e)) throw e;
        await prisma.card.delete({ where: { id: sub.id } });
        continue;
      }
      subId = sub.id;
      created++;
      await recordActivity(cardId, null, "subtask", { added: title });
      await recordActivity(sub.id, null, "created");
      if (!c.resolved)
        await notifyWatchers({
          cardId,
          boardId,
          workspaceId: app.workspaceId,
          actor: { id: "", name: author, email: "" },
          change: `left a review comment (${clip(oneLine(c.text), 80)})`,
        }).catch(() => {});
    }

    // The thread: each reply becomes a comment on the comment's subtask, once.
    if (subId && c.replies?.length) {
      for (const rp of c.replies) {
        const rkey = {
          appId_kind_externalId: {
            appId: app.id,
            kind: "review-reply",
            externalId: rp.id,
          },
        };
        if (await prisma.suiteItem.findUnique({ where: rkey })) continue;
        const authorId = await replyAuthor();
        if (!authorId) continue;
        const who = oneLine(rp.author) || "A reviewer";
        try {
          await prisma.suiteItem.create({
            data: {
              appId: app.id,
              kind: "review-reply",
              externalId: rp.id,
              cardId: subId,
              state: { comment: true },
            },
          });
        } catch (e) {
          if (!isUnique(e)) throw e;
          continue;
        }
        const body = JSON.stringify({
          type: "doc",
          content: rp.text
            .split(/\n{1,}/)
            .filter((l) => l.trim())
            .map((l) => para(text(l.trim()))),
        });
        await prisma.comment.create({
          data: {
            cardId: subId,
            authorId,
            body,
            importedAuthor: fromCourseForge(who),
            ...(rp.createdAt ? { createdAt: new Date(rp.createdAt) } : {}),
          },
        });
        await notifyWatchers({
          cardId: subId,
          boardId: boardForSub,
          workspaceId: app.workspaceId,
          actor: { id: "", name: who, email: "" },
          change: `replied to a review comment (${clip(oneLine(rp.text), 80)})`,
        }).catch(() => {});
      }
    }
  }

  const view = await cardView(cardId, base);
  if (!view) return { card: null, reason: "deleted" };
  return { card: view, subtasks: { created, updated } };
}
