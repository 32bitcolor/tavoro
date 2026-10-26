"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, getActiveMembership } from "@/lib/dal";
import { Role } from "@/generated/prisma/client";
import { getBoardForUser, getCardForUser, projectVisibilityWhere, whiteboardVisibilityWhere } from "@/lib/authz";
import { parseAnchor } from "@/lib/review-anchor";
import { excerpt, quoteOf } from "@/lib/review-feedback";
import { positionBetween } from "@/lib/ordering";
import { enqueueEmail } from "@/lib/queues";
import { subtaskAssigned, cardAssigned, smeAssigned, commentPosted, mentioned, withLink } from "@/lib/email-templates";
import { appUrl } from "@/lib/app-url";
import { extractMentionIds, extractText } from "@/lib/mentions";
import { notificationsEnabled, notifySubtaskStatusChange } from "@/lib/notify";
import { nextCardKeySeq } from "@/lib/card-keys";

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid color");
const LabelName = z.string().trim().min(1).max(60);
const Title = z.string().trim().min(1).max(280);

function boardPath(boardId: string) {
  return `/boards/${boardId}`;
}

/** Full detail for the card drawer: the card, the board's labels, and the workspace members.
 * A subtask is just a Card with parentCardId set — this returns the identical shape for
 * either, plus isSubtask/parent so the drawer can show a "back to parent" link and hide
 * its own Subtasks section (nesting stops at one level). */
export async function getCardDetail(cardId: string) {
  const access = await getCardForUser(cardId);
  if (!access) return null;
  const boardId = access.boardId;

  const me = await getCurrentUser();
  if (!me) return null;

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      workspaceId: true,
      cardKeyPrefix: true,
      project: { select: { sprintsEnabled: true } },
      groupAccess: { select: { groupId: true } },
    },
  });
  if (!board) return null;
  // Sprint assignment is offered for standalone-board cards and cards whose
  // project has opted into sprint planning.
  const sprintsEnabled = !board.project || board.project.sprintsEnabled;

  const [card, workspaceLabels, members, membership, sprints] = await Promise.all([
    prisma.card.findUnique({
      where: { id: cardId },
      select: {
        id: true,
        title: true,
        description: true,
        dueDate: true,
        keySeq: true,
        sprintId: true,
        done: true,
        private: true,
        statusId: true,
        status: { select: { category: true } },
        parentCardId: true,
        parentCard: { select: { id: true, title: true } },
        labels: { select: { labelId: true } },
        assignees: { select: { userId: true } },
        smes: { select: { userId: true } },
        subtasks: {
          orderBy: { position: "asc" },
          select: {
            id: true, title: true, done: true, dueDate: true, keySeq: true,
            assignees: { select: { userId: true } },
            _count: { select: { comments: true, attachments: true } },
          },
        },
        comments: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            body: true,
            createdAt: true,
            author: { select: { id: true, name: true, email: true } },
          },
        },
        attachments: {
          orderBy: { createdAt: "asc" },
          select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
        },
      },
    }),
    prisma.label.findMany({
      where: { workspaceId: board.workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
    prisma.user.findMany({
      where: { memberships: { some: { workspaceId: board.workspaceId, suspendedAt: null } } },
      orderBy: { email: "asc" },
      select: { id: true, name: true, email: true },
    }),
    prisma.membership.findFirst({
      where: { userId: me.id, workspaceId: board.workspaceId, suspendedAt: null },
      select: { role: true },
    }),
    prisma.sprint.findMany({
      where: { workspaceId: board.workspaceId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);
  if (!card) return null;

  // Members who can actually see this board — the pool for @-mentions. Open
  // boards → everyone; group-restricted boards → admins + members of those groups.
  const groupIds = board.groupAccess.map((g) => g.groupId);
  const mentionable =
    groupIds.length === 0
      ? members
      : await prisma.user.findMany({
          where: {
            memberships: { some: { workspaceId: board.workspaceId, suspendedAt: null } },
            OR: [
              { memberships: { some: { workspaceId: board.workspaceId, role: "ADMIN", suspendedAt: null } } },
              { groupMemberships: { some: { groupId: { in: groupIds } } } },
            ],
          },
          orderBy: { email: "asc" },
          select: { id: true, name: true, email: true },
        });

  const whiteboards = await prisma.whiteboard.findMany({
    where: { cardId, ...(await whiteboardVisibilityWhere()) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true },
  });

  // Review comments this card (or one of its subtasks) was made from — only those on
  // projects this member can see.
  const reviewComments = await prisma.reviewComment.findMany({
    where: {
      cardId: { in: [card.id, ...card.subtasks.map((s) => s.id)] },
      round: { deliverable: { project: { workspaceId: board.workspaceId, ...(await projectVisibilityWhere()) } } },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      cardId: true,
      body: true,
      anchor: true,
      status: true,
      roundId: true,
      round: { select: { number: true, deliverable: { select: { name: true } } } },
      author: { select: { name: true, email: true } },
      guest: { select: { name: true } },
    },
  });
  const subtaskTitle = new Map(card.subtasks.map((s) => [s.id, s.title]));

  return {
    boardId,
    boardCardKeyPrefix: board.cardKeyPrefix,
    card: {
      id: card.id,
      title: card.title,
      description: card.description,
      dueDate: card.dueDate ? card.dueDate.toISOString() : null,
      keySeq: card.keySeq,
      sprintId: card.sprintId,
      private: card.private,
      statusId: card.statusId,
      labelIds: card.labels.map((l) => l.labelId),
      assigneeIds: card.assignees.map((a) => a.userId),
      smeIds: card.smes.map((s) => s.userId),
    },
    isSubtask: card.parentCardId !== null,
    parent: card.parentCard,
    workspaceLabels,
    members,
    mentionable,
    sprints,
    sprintsEnabled,
    whiteboards,
    cardDone: card.parentCardId ? card.done : card.status?.category === "done",
    reviewFeedback: reviewComments.map((c) => ({
      id: c.id,
      roundId: c.roundId,
      roundNumber: c.round.number,
      deliverableName: c.round.deliverable.name,
      status: c.status,
      excerpt: excerpt(c.body, 160),
      quote: quoteOf(parseAnchor(c.anchor)) ?? null,
      author: c.author ? (c.author.name ?? c.author.email) : c.guest ? `${c.guest.name} (guest)` : "Former reviewer",
      subtask: c.cardId !== card.id ? { id: c.cardId!, title: subtaskTitle.get(c.cardId!) ?? "" } : null,
    })),
    currentUserId: me.id,
    isAdmin: membership?.role === "ADMIN",
    subtasks: card.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      done: s.done,
      dueDate: s.dueDate ? s.dueDate.toISOString() : null,
      keySeq: s.keySeq,
      assigneeIds: s.assignees.map((a) => a.userId),
      commentCount: s._count.comments,
      attachmentCount: s._count.attachments,
    })),
    comments: card.comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      author: c.author,
    })),
    attachments: card.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export async function updateCardDescription(cardId: string, description: string | null) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };

  const prev = await prisma.card.findUnique({ where: { id: cardId }, select: { description: true, title: true } });
  await prisma.card.update({
    where: { id: cardId },
    data: { description: description && description.trim() ? description : null },
  });
  revalidatePath(boardPath(card.boardId));

  // Notify only newly-added @-mentions — not on every autosave.
  const oldIds = new Set(extractMentionIds(prev?.description ?? null));
  const newIds = extractMentionIds(description).filter((id) => !oldIds.has(id));
  if (newIds.length === 0) return;

  const me = await getCurrentUser();
  const board = await prisma.board.findUnique({ where: { id: card.boardId }, select: { name: true, workspaceId: true } });
  if (!board) return;
  if (!(await notificationsEnabled(board.workspaceId, "mention"))) return;
  const mentions = await prisma.user.findMany({
    where: { id: { in: newIds, not: me?.id }, memberships: { some: { workspaceId: board.workspaceId, suspendedAt: null } } },
    select: { name: true, email: true },
  });
  const link = appUrl(`/boards/${card.boardId}?card=${cardId}`);
  const excerpt = extractText(description).slice(0, 200);
  for (const m of mentions) {
    if (!m.email) continue;
    await enqueueEmail({
      to: m.email,
      ...withLink(
        mentioned({
          recipientName: m.name ?? m.email,
          mentionerName: me?.name ?? me?.email ?? "Someone",
          context: "the description",
          cardTitle: prev?.title ?? "",
          boardName: board.name,
          excerpt,
        }),
        link,
      ),
    });
  }
}

export async function setCardDueDate(cardId: string, iso: string | null) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };
  const dueDate = iso ? new Date(iso) : null;
  if (iso && Number.isNaN(dueDate!.getTime())) return { error: "Invalid date." };
  await prisma.card.update({ where: { id: cardId }, data: { dueDate } });
  revalidatePath(boardPath(card.boardId));
}

// ── Labels ───────────────────────────────────────────────────────────────────

/** Create a workspace label. `boardId` is the context the user is creating from —
 *  it carries the group-aware access check and tells us which revalidate. Because
 *  labels are workspace-wide and unique per name, creating one that already exists
 *  returns the existing label rather than erroring: from the card drawer, "add the
 *  label called Bug" should succeed whether or not another board got there first. */
export async function createLabel(boardId: string, name: string, color: string) {
  const board = await getBoardForUser(boardId);
  if (!board) return { error: "Board not found." };
  const n = LabelName.safeParse(name);
  const c = Hex.safeParse(color);
  if (!n.success || !c.success) return { error: "Invalid label." };

  const existing = await prisma.label.findFirst({
    where: { workspaceId: board.workspaceId, name: { equals: n.data, mode: "insensitive" } },
    select: { id: true, name: true, color: true },
  });
  if (existing) return { label: existing };

  const label = await prisma.label.create({
    data: { workspaceId: board.workspaceId, name: n.data, color: c.data },
    select: { id: true, name: true, color: true },
  });
  revalidatePath(boardPath(boardId));
  return { label };
}

/** Delete a workspace label. This strips it from every card in the workspace, so
 *  unlike applying a label it's an admin-only control. */
export async function deleteLabel(labelId: string) {
  const membership = await getActiveMembership();
  if (!membership) return { error: "Unauthorized." };
  if (membership.role !== Role.ADMIN) {
    return { error: "Only workspace admins can delete labels." };
  }
  const label = await prisma.label.findFirst({
    where: { id: labelId, workspaceId: membership.workspaceId },
    select: { id: true },
  });
  if (!label) return { error: "Label not found." };
  await prisma.label.delete({ where: { id: labelId } });
  revalidatePath("/boards");
  revalidatePath("/sprints");
  revalidatePath("/settings/labels");
}

/** List every label in the active workspace, with how many cards carry each.
 *  Backs Settings → Labels. */
export async function listWorkspaceLabels() {
  const membership = await getActiveMembership();
  if (!membership) return { error: "Unauthorized." as const };
  const labels = await prisma.label.findMany({
    where: { workspaceId: membership.workspaceId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true, _count: { select: { cards: true } } },
  });
  return {
    labels: labels.map((l) => ({ id: l.id, name: l.name, color: l.color, uses: l._count.cards })),
    canManage: membership.role === Role.ADMIN,
  };
}

/** Rename / recolour a workspace label. Admin-only, matching delete — a rename is
 *  workspace-wide and shows up on every card carrying it. */
export async function updateLabel(labelId: string, name: string, color: string) {
  const membership = await getActiveMembership();
  if (!membership) return { error: "Unauthorized." };
  if (membership.role !== Role.ADMIN) {
    return { error: "Only workspace admins can edit labels." };
  }
  const n = LabelName.safeParse(name);
  const c = Hex.safeParse(color);
  if (!n.success || !c.success) return { error: "Invalid label." };

  const label = await prisma.label.findFirst({
    where: { id: labelId, workspaceId: membership.workspaceId },
    select: { id: true },
  });
  if (!label) return { error: "Label not found." };

  const clash = await prisma.label.findFirst({
    where: {
      workspaceId: membership.workspaceId,
      name: { equals: n.data, mode: "insensitive" },
      id: { not: labelId },
    },
    select: { id: true },
  });
  if (clash) return { error: `A label called "${n.data}" already exists.` };

  const updated = await prisma.label.update({
    where: { id: labelId },
    data: { name: n.data, color: c.data },
    select: { id: true, name: true, color: true },
  });
  revalidatePath("/boards");
  revalidatePath("/sprints");
  revalidatePath("/settings/labels");
  return { label: updated };
}

export async function toggleCardLabel(cardId: string, labelId: string, on: boolean) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };
  // Ensure the label belongs to the same workspace as the card. Labels are no longer
  // board-scoped, so the board is the wrong unit to check against.
  const board = await getBoardForUser(card.boardId);
  if (!board) return { error: "Card not found." };
  const label = await prisma.label.findFirst({
    where: { id: labelId, workspaceId: board.workspaceId },
    select: { id: true },
  });
  if (!label) return { error: "Label not found." };

  if (on) {
    await prisma.cardLabel.upsert({
      where: { cardId_labelId: { cardId, labelId } },
      create: { cardId, labelId },
      update: {},
    });
  } else {
    await prisma.cardLabel.deleteMany({ where: { cardId, labelId } });
  }
  revalidatePath(boardPath(card.boardId));
}

// ── Assignees ────────────────────────────────────────────────────────────────

export async function toggleCardAssignee(cardId: string, userId: string, on: boolean) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };

  const board = await prisma.board.findUnique({
    where: { id: card.boardId },
    select: { workspaceId: true, name: true },
  });
  if (!board) return { error: "Board not found." };

  // only workspace members may be assigned
  const member = await prisma.membership.findFirst({
    where: { userId, workspaceId: board.workspaceId, suspendedAt: null },
    select: { id: true },
  });
  if (!member) return { error: "Not a workspace member." };

  const wasAssigned = await prisma.cardAssignee.findUnique({
    where: { cardId_userId: { cardId, userId } },
    select: { userId: true },
  });

  if (on) {
    await prisma.cardAssignee.upsert({
      where: { cardId_userId: { cardId, userId } },
      create: { cardId, userId },
      update: {},
    });
  } else {
    await prisma.cardAssignee.deleteMany({ where: { cardId, userId } });
  }

  // Notify the assignee on a new assignment (skip assigning yourself). Subtasks
  // and top-level cards get their own template.
  if (on && !wasAssigned && (await notificationsEnabled(board.workspaceId, "assignment"))) {
    const me = await getCurrentUser();
    if (userId !== me?.id) {
      const [assignee, cardRow] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
        prisma.card.findUnique({ where: { id: cardId }, select: { title: true } }),
      ]);
      if (assignee?.email && cardRow) {
        const link = appUrl(`/boards/${card.boardId}?card=${cardId}`);
        if (card.parentCardId) {
          const parentCard = await prisma.card.findUnique({
            where: { id: card.parentCardId },
            select: { title: true },
          });
          await enqueueEmail({
            to: assignee.email,
            ...withLink(
              subtaskAssigned({
                assigneeName: assignee.name ?? assignee.email,
                subtaskText: cardRow.title,
                cardTitle: parentCard?.title ?? "",
                boardName: board.name,
              }),
              link,
            ),
          });
        } else {
          await enqueueEmail({
            to: assignee.email,
            ...withLink(
              cardAssigned({
                assigneeName: assignee.name ?? assignee.email,
                cardTitle: cardRow.title,
                boardName: board.name,
              }),
              link,
            ),
          });
        }
      }
    }
  }

  revalidatePath(boardPath(card.boardId));
}

/** Add or remove a subject-matter expert on a card/subtask (workspace members only). */
export async function toggleCardSme(cardId: string, userId: string, on: boolean) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };

  const board = await prisma.board.findUnique({
    where: { id: card.boardId },
    select: { workspaceId: true, name: true },
  });
  if (!board) return { error: "Board not found." };

  const member = await prisma.membership.findFirst({
    where: { userId, workspaceId: board.workspaceId, suspendedAt: null },
    select: { id: true },
  });
  if (!member) return { error: "Not a workspace member." };

  const wasSme = await prisma.cardSme.findUnique({
    where: { cardId_userId: { cardId, userId } },
    select: { userId: true },
  });

  if (on) {
    await prisma.cardSme.upsert({
      where: { cardId_userId: { cardId, userId } },
      create: { cardId, userId },
      update: {},
    });
  } else {
    await prisma.cardSme.deleteMany({ where: { cardId, userId } });
  }

  revalidatePath(boardPath(card.boardId));

  // Notify a newly named SME (skip naming yourself).
  if (on && !wasSme && (await notificationsEnabled(board.workspaceId, "assignment"))) {
    const me = await getCurrentUser();
    if (userId !== me?.id) {
      const [sme, cardRow] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
        prisma.card.findUnique({ where: { id: cardId }, select: { title: true } }),
      ]);
      if (sme?.email && cardRow) {
        await enqueueEmail({
          to: sme.email,
          ...withLink(
            smeAssigned({ smeName: sme.name ?? sme.email, cardTitle: cardRow.title, boardName: board.name }),
            appUrl(`/boards/${card.boardId}?card=${cardId}`),
          ),
        });
      }
    }
  }
}

// ── Subtasks ─────────────────────────────────────────────────────────────────
// A subtask is a real Card with parentCardId set and columnId null — it gets
// comments, attachments, assignees, and labels for free via the same relations
// a top-level card already has. Nesting stops at one level: a card that's
// already a subtask never gets its own "Add a subtask" affordance.

export async function addSubtask(parentCardId: string, title: string) {
  const parent = await getCardForUser(parentCardId);
  if (!parent) return { error: "Card not found." };
  const parsed = Title.safeParse(title);
  if (!parsed.success) return { error: "Title is required." };

  const last = await prisma.card.findFirst({
    where: { parentCardId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const keySeq = await nextCardKeySeq(parent.boardId);
  const item = await prisma.card.create({
    data: { parentCardId, title: parsed.data, keySeq, position: positionBetween(last?.position ?? null, null) },
    select: { id: true, title: true, done: true, dueDate: true, keySeq: true },
  });
  revalidatePath(boardPath(parent.boardId));
  return {
    item: {
      id: item.id, title: item.title, done: item.done, keySeq: item.keySeq,
      dueDate: item.dueDate ? item.dueDate.toISOString() : null,
      assigneeIds: [] as string[], commentCount: 0, attachmentCount: 0,
    },
  };
}

export async function toggleSubtask(cardId: string, done: boolean) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Item not found." };
  const before = await prisma.card.findUnique({ where: { id: cardId }, select: { done: true } });
  await prisma.card.update({ where: { id: cardId }, data: { done } });
  revalidatePath(boardPath(card.boardId));

  if (card.parentCardId && before?.done !== done) {
    const board = await prisma.board.findUnique({ where: { id: card.boardId }, select: { workspaceId: true } });
    if (board) {
      const actor = await getCurrentUser();
      await notifySubtaskStatusChange({
        subtaskId: cardId,
        parentCardId: card.parentCardId,
        boardId: card.boardId,
        workspaceId: board.workspaceId,
        done,
        actor: actor ? { id: actor.id, name: actor.name, email: actor.email } : null,
      });
    }
  }
}

export async function deleteSubtask(cardId: string) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Item not found." };
  await prisma.card.delete({ where: { id: cardId } });
  revalidatePath(boardPath(card.boardId));
}

// ── Comments ─────────────────────────────────────────────────────────────────

export async function addComment(cardId: string, body: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Unauthorized." };
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };
  // Comments are now a TipTap JSON document, so allow more than the old
  // plain-text cap (the JSON wrapper + mention nodes add overhead).
  const parsed = z.string().trim().min(1).max(20000).safeParse(body);
  if (!parsed.success) return { error: "Comment is empty." };

  const comment = await prisma.comment.create({
    data: { cardId, authorId: user.id, body: parsed.data },
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true, email: true } },
    },
  });
  revalidatePath(boardPath(card.boardId));

  // Notify: @-mentions get a mention email; the card's assignees + SMEs (minus
  // the commenter and anyone already mentioned) get a comment email.
  const [cardRow, boardRow] = await Promise.all([
    prisma.card.findUnique({ where: { id: cardId }, select: { title: true } }),
    prisma.board.findUnique({ where: { id: card.boardId }, select: { name: true, workspaceId: true } }),
  ]);
  const link = appUrl(`/boards/${card.boardId}?card=${cardId}`);
  const commenterName = user.name ?? user.email;
  const cardTitle = cardRow?.title ?? "";
  const boardName = boardRow?.name ?? "";
  const excerpt = extractText(parsed.data).slice(0, 200);
  const notified = new Set<string>([user.id]);

  const mentionIds = extractMentionIds(parsed.data);
  if (mentionIds.length && boardRow && (await notificationsEnabled(boardRow.workspaceId, "mention"))) {
    const mentions = await prisma.user.findMany({
      where: { id: { in: mentionIds }, memberships: { some: { workspaceId: boardRow.workspaceId, suspendedAt: null } } },
      select: { id: true, name: true, email: true },
    });
    for (const m of mentions) {
      if (notified.has(m.id) || !m.email) continue;
      notified.add(m.id);
      await enqueueEmail({
        to: m.email,
        ...withLink(
          mentioned({ recipientName: m.name ?? m.email, mentionerName: commenterName, context: "a comment", cardTitle, boardName, excerpt }),
          link,
        ),
      });
    }
  }

  if (boardRow && (await notificationsEnabled(boardRow.workspaceId, "comment"))) {
    const others = await prisma.user.findMany({
      where: {
        id: { notIn: [...notified] },
        OR: [{ assignedCards: { some: { cardId } } }, { smeCards: { some: { cardId } } }],
      },
      select: { name: true, email: true },
    });
    for (const r of others) {
      if (!r.email) continue;
      await enqueueEmail({
        to: r.email,
        ...withLink(commentPosted({ recipientName: r.name ?? r.email, commenterName, cardTitle, boardName, excerpt }), link),
      });
    }
  }

  return { comment: { ...comment, createdAt: comment.createdAt.toISOString() } };
}

export async function deleteComment(commentId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Unauthorized." };
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, authorId: true, cardId: true },
  });
  const card = comment ? await getCardForUser(comment.cardId) : null;
  if (!comment || !card) return { error: "Comment not found." };

  const board = await prisma.board.findUnique({ where: { id: card.boardId }, select: { workspaceId: true } });
  let allowed = comment.authorId === user.id;
  if (!allowed && board) {
    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, workspaceId: board.workspaceId, suspendedAt: null },
      select: { role: true },
    });
    allowed = membership?.role === "ADMIN";
  }
  if (!allowed) return { error: "Not allowed." };

  await prisma.comment.delete({ where: { id: commentId } });
  revalidatePath(boardPath(card.boardId));
}
