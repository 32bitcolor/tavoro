import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { getCurrentUser, usableMembershipWhere } from "@/lib/dal";
import { currentPrincipal } from "@/lib/principal";
import { Prisma, Role } from "@/generated/prisma/client";

// Resource-level authorization. A user may touch a board/column/card/project/etc.
// only if they are a member of the workspace that (transitively) owns it AND they
// pass the group-access check below. Each helper returns the resource (with the ids
// needed for revalidation) or null if absent/forbidden.

// The workspaces the user may act in right now (see getAccessContext). An MCP token is
// issued for one workspace: through it, only that workspace counts as the user's.
const ownedByUser = (ctx: { workspaceIds: string[] }) => ({ id: { in: ctx.workspaceIds } });

// Per-request access context, memoized for the render pass: which workspaces the user
// may act in (active memberships that meet any SSO requirement — a suspended member's
// leftover session opens nothing), which of those they have blanket ("see everything")
// visibility into — ADMIN and MANAGER alike — and which groups they belong to.
const getAccessContext = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  const workspaceId = currentPrincipal()?.workspaceId ?? null;
  const [memberships, groups] = await Promise.all([
    prisma.membership.findMany({
      where: { userId: user.id, ...(await usableMembershipWhere()), ...(workspaceId ? { workspaceId } : {}) },
      select: { workspaceId: true, role: true },
    }),
    prisma.groupMembership.findMany({ where: { userId: user.id }, select: { groupId: true } }),
  ]);
  return {
    userId: user.id,
    workspaceIds: memberships.map((m) => m.workspaceId),
    elevatedWorkspaceIds: memberships
      .filter((m) => m.role === Role.ADMIN || m.role === Role.MANAGER)
      .map((m) => m.workspaceId),
    groupIds: groups.map((g) => g.groupId),
  };
});

type Ctx = NonNullable<Awaited<ReturnType<typeof getAccessContext>>>;

// Default-open access rule, expressed as a Prisma OR at the resource level: the
// resource is visible if the user administers its workspace, it has NO group
// grants (open to all members), or it's shared with a group the user is in.
function boardAccessOR(ctx: Ctx): Prisma.BoardWhereInput {
  return {
    OR: [
      { workspaceId: { in: ctx.elevatedWorkspaceIds } },
      { groupAccess: { none: {} } },
      { groupAccess: { some: { groupId: { in: ctx.groupIds } } } },
    ],
  };
}
function storyboardAccessOR(ctx: Ctx): Prisma.StoryboardWhereInput {
  return {
    OR: [
      { workspaceId: { in: ctx.elevatedWorkspaceIds } },
      { groupAccess: { none: {} } },
      { groupAccess: { some: { groupId: { in: ctx.groupIds } } } },
    ],
  };
}
function projectAccessOR(ctx: Ctx): Prisma.ProjectWhereInput {
  return {
    OR: [
      { workspaceId: { in: ctx.elevatedWorkspaceIds } },
      { groupAccess: { none: {} } },
      { groupAccess: { some: { groupId: { in: ctx.groupIds } } } },
    ],
  };
}
function whiteboardAccessOR(ctx: Ctx): Prisma.WhiteboardWhereInput {
  return {
    OR: [
      { workspaceId: { in: ctx.elevatedWorkspaceIds } },
      { groupAccess: { none: {} } },
      { groupAccess: { some: { groupId: { in: ctx.groupIds } } } },
    ],
  };
}

// Visibility `where` fragments for list/dashboard queries (which query Prisma
// directly instead of going through the getters). Spread alongside `workspaceId`.
export async function boardVisibilityWhere(): Promise<Prisma.BoardWhereInput> {
  const ctx = await getAccessContext();
  return ctx ? boardAccessOR(ctx) : { id: { in: [] } };
}
export async function storyboardVisibilityWhere(): Promise<Prisma.StoryboardWhereInput> {
  const ctx = await getAccessContext();
  return ctx ? storyboardAccessOR(ctx) : { id: { in: [] } };
}
export async function projectVisibilityWhere(): Promise<Prisma.ProjectWhereInput> {
  const ctx = await getAccessContext();
  return ctx ? projectAccessOR(ctx) : { id: { in: [] } };
}
export async function whiteboardVisibilityWhere(): Promise<Prisma.WhiteboardWhereInput> {
  const ctx = await getAccessContext();
  return ctx ? whiteboardAccessOR(ctx) : { id: { in: [] } };
}

// ── Boards ───────────────────────────────────────────────────────────────────

export async function getBoardForUser(boardId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.board.findFirst({
    where: { id: boardId, workspace: ownedByUser(ctx), ...boardAccessOR(ctx) },
    select: { id: true, name: true, workspaceId: true, cardKeyPrefix: true },
  });
}

/** Resolve a card's short key ("WP-5") to its board + card, for the /c/[key]
 * short-link route. Prefix match is case-insensitive; access is the same
 * group-based visibility as everything else. */
export async function resolveCardKey(prefix: string, keySeq: number) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  const board = await prisma.board.findFirst({
    where: { cardKeyPrefix: { equals: prefix, mode: "insensitive" }, workspace: ownedByUser(ctx) },
    select: { id: true },
  });
  if (!board) return null;
  const visible = await prisma.board.count({ where: { id: board.id, ...boardAccessOR(ctx) } });
  const card = visible
    ? await prisma.card.findFirst({
        where: {
          keySeq,
          OR: [
            { columnId: { not: null }, column: { boardId: board.id } },
            { parentCardId: { not: null }, parentCard: { column: { boardId: board.id } } },
          ],
        },
        select: { id: true, title: true, parentCardId: true },
      })
    : null;
  if (card) return { boardId: board.id, cardId: card.id, title: card.title, isSubtask: card.parentCardId != null };

  // A key the card had before it moved to another board: follow it to where it is now,
  // if this member can see that board.
  const alias = await prisma.cardKeyAlias.findUnique({
    where: { boardId_keySeq: { boardId: board.id, keySeq } },
    select: { cardId: true },
  });
  if (!alias) return null;
  const moved = await prisma.card.findFirst({
    where: {
      id: alias.cardId,
      OR: [
        { column: { board: { workspace: ownedByUser(ctx), ...boardAccessOR(ctx) } } },
        { parentCard: { column: { board: { workspace: ownedByUser(ctx), ...boardAccessOR(ctx) } } } },
      ],
    },
    select: { id: true, title: true, parentCardId: true, column: { select: { boardId: true } }, parentCard: { select: { column: { select: { boardId: true } } } } },
  });
  if (!moved) return null;
  const boardId = moved.column?.boardId ?? moved.parentCard!.column!.boardId;
  return { boardId, cardId: moved.id, title: moved.title, isSubtask: moved.parentCardId != null };
}

export async function getColumnForUser(columnId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.column.findFirst({
    where: { id: columnId, board: { workspace: ownedByUser(ctx), ...boardAccessOR(ctx) } },
    select: { id: true, boardId: true, statusId: true },
  });
}

// A card's columnId is null when it's a subtask (see Card.parentCardId) — access
// resolves through the parent card's column instead, one hop only (subtasks can't
// nest further, so this never needs to recurse).
export async function getCardForUser(cardId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  const card = await prisma.card.findFirst({
    where: {
      id: cardId,
      OR: [
        { column: { board: { workspace: ownedByUser(ctx), ...boardAccessOR(ctx) } } },
        { parentCard: { column: { board: { workspace: ownedByUser(ctx), ...boardAccessOR(ctx) } } } },
      ],
    },
    select: {
      id: true,
      columnId: true,
      parentCardId: true,
      column: { select: { boardId: true } },
      parentCard: { select: { column: { select: { boardId: true } } } },
    },
  });
  if (!card) return null;
  const boardId = card.column?.boardId ?? card.parentCard!.column!.boardId;
  return { id: card.id, columnId: card.columnId, parentCardId: card.parentCardId, boardId };
}

// ── Projects ─────────────────────────────────────────────────────────────────

export async function getProjectForUser(projectId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.project.findFirst({
    where: { id: projectId, workspace: ownedByUser(ctx), ...projectAccessOR(ctx) },
    select: { id: true, name: true, workspaceId: true },
  });
}

export async function getPhaseForUser(phaseId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.phase.findFirst({
    where: { id: phaseId, project: { workspace: ownedByUser(ctx), ...projectAccessOR(ctx) } },
    select: { id: true, projectId: true },
  });
}

// ── Intake ───────────────────────────────────────────────────────────────────
// No group-sharing concept here — triage is workspace-wide for every member,
// same as ReviewCycle — so this skips the xxxAccessOR step the other resources use.

export async function getIntakeRequestForUser(requestId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.intakeRequest.findFirst({
    where: { id: requestId, workspace: ownedByUser(ctx) },
    include: { workspace: { select: { name: true } } },
  });
}

export async function intakeVisibilityWhere(): Promise<Prisma.IntakeRequestWhereInput> {
  const ctx = await getAccessContext();
  return ctx ? {} : { id: { in: [] } };
}

export async function getDeliverableForUser(deliverableId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.deliverable.findFirst({
    where: { id: deliverableId, project: { workspace: ownedByUser(ctx), ...projectAccessOR(ctx) } },
    select: { id: true, projectId: true },
  });
}

export async function getMilestoneForUser(milestoneId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.milestone.findFirst({
    where: { id: milestoneId, project: { workspace: ownedByUser(ctx), ...projectAccessOR(ctx) } },
    select: { id: true, projectId: true },
  });
}

export async function getReviewForUser(reviewId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.reviewCycle.findFirst({
    where: { id: reviewId, deliverable: { project: { workspace: ownedByUser(ctx), ...projectAccessOR(ctx) } } },
    select: {
      id: true,
      roundId: true,
      reviewerId: true,
      guestId: true,
      deliverable: { select: { projectId: true, project: { select: { workspaceId: true } } } },
    },
  });
}

export async function getReviewRoundForUser(roundId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.reviewRound.findFirst({
    where: { id: roundId, deliverable: { project: { workspace: ownedByUser(ctx), ...projectAccessOR(ctx) } } },
    select: {
      id: true,
      number: true,
      deliverableId: true,
      deliverable: { select: { projectId: true, project: { select: { workspaceId: true } } } },
    },
  });
}

export async function getReviewCommentForUser(commentId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.reviewComment.findFirst({
    where: {
      id: commentId,
      round: { deliverable: { project: { workspace: ownedByUser(ctx), ...projectAccessOR(ctx) } } },
    },
    select: { id: true, roundId: true, authorId: true, parentId: true },
  });
}

/** True when the current user is an ADMIN or MANAGER of the workspace — the roles that
 *  may override a review round's approval gate. Checked server-side, never trusted
 *  from the UI. */
export async function isElevatedInWorkspace(workspaceId: string): Promise<boolean> {
  const ctx = await getAccessContext();
  return !!ctx && ctx.elevatedWorkspaceIds.includes(workspaceId);
}

export async function getTimeEntryForUser(timeEntryId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.timeEntry.findFirst({
    where: { id: timeEntryId, project: { workspace: ownedByUser(ctx), ...projectAccessOR(ctx) } },
    select: { id: true, projectId: true },
  });
}

export async function getObjectiveForUser(objectiveId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.learningObjective.findFirst({
    where: { id: objectiveId, project: { workspace: ownedByUser(ctx), ...projectAccessOR(ctx) } },
    select: { id: true, projectId: true },
  });
}

export async function getAssessmentItemForUser(itemId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.assessmentItem.findFirst({
    where: { id: itemId, project: { workspace: ownedByUser(ctx), ...projectAccessOR(ctx) } },
    select: { id: true, projectId: true },
  });
}

// ── Storyboards ──────────────────────────────────────────────────────────────

export async function getStoryboardForUser(storyboardId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.storyboard.findFirst({
    where: { id: storyboardId, workspace: ownedByUser(ctx), ...storyboardAccessOR(ctx) },
    select: { id: true, workspaceId: true },
  });
}

export async function getScreenForUser(screenId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.screen.findFirst({
    where: { id: screenId, storyboard: { workspace: ownedByUser(ctx), ...storyboardAccessOR(ctx) } },
    select: { id: true, storyboardId: true },
  });
}

// ── Whiteboards ──────────────────────────────────────────────────────────────

export async function getWhiteboardForUser(whiteboardId: string) {
  const ctx = await getAccessContext();
  if (!ctx) return null;
  return prisma.whiteboard.findFirst({
    where: { id: whiteboardId, workspace: ownedByUser(ctx), ...whiteboardAccessOR(ctx) },
    select: { id: true, workspaceId: true },
  });
}
