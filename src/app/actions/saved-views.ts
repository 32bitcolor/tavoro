"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { getBoardForUser } from "@/lib/authz";
import {
  BOARD_VIEW_SCOPE,
  SPRINT_VIEW_SCOPE,
  QUERY_VIEW_SCOPE,
  QueryFilters,
  ViewScopeEnum,
  ViewName,
  BoardFilters,
  SprintFilters,
  parseFilters,
  filtersAreActive,
} from "@/lib/saved-views";

export type SavedViewDTO = {
  id: string;
  name: string;
  scope: string;
  filters: unknown;
};

/** Saved views belong to the user, not the workspace — so every query is scoped by
 *  userId as well as workspace. Board views additionally go through the group-aware
 *  board check, so a view can't outlive losing access to its board. */
export async function listSavedViews(scope: string, boardId?: string): Promise<SavedViewDTO[]> {
  const membership = await getActiveMembership();
  if (!membership) return [];
  const s = ViewScopeEnum.safeParse(scope);
  if (!s.success) return [];
  if (s.data === BOARD_VIEW_SCOPE) {
    if (!boardId || !(await getBoardForUser(boardId))) return [];
  }

  const rows = await prisma.savedView.findMany({
    where: {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      scope: s.data,
      boardId: s.data === BOARD_VIEW_SCOPE ? boardId : null,
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, scope: true, filters: true },
  });
  return rows.map((r) => ({ ...r, filters: parseFilters(r.scope, r.filters) }));
}

/** Create or overwrite a view by name. Saving over an existing name updates it —
 *  "save" on a name you already used means "update it", not "make a second one". */
export async function saveView(
  scope: string,
  boardId: string | null,
  name: string,
  filters: unknown,
) {
  const membership = await getActiveMembership();
  if (!membership) return { error: "Unauthorized." };

  const s = ViewScopeEnum.safeParse(scope);
  if (!s.success) return { error: "Unknown view type." };
  const n = ViewName.safeParse(name);
  if (!n.success) return { error: "Give the view a name." };

  let scopedBoardId: string | null = null;
  if (s.data === BOARD_VIEW_SCOPE) {
    if (!boardId) return { error: "Board not found." };
    const board = await getBoardForUser(boardId);
    if (!board || board.workspaceId !== membership.workspaceId) return { error: "Board not found." };
    scopedBoardId = board.id;
  }

  const shape = s.data === SPRINT_VIEW_SCOPE ? SprintFilters : s.data === QUERY_VIEW_SCOPE ? QueryFilters : BoardFilters;
  const parsed = shape.safeParse(filters ?? {});
  if (!parsed.success) return { error: "Those filters can't be saved." };
  if (!filtersAreActive(s.data, parsed.data)) {
    return { error: "Set at least one filter before saving a view." };
  }

  const existing = await prisma.savedView.findFirst({
    where: {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      scope: s.data,
      boardId: scopedBoardId,
      name: { equals: n.data, mode: "insensitive" },
    },
    select: { id: true },
  });

  const view = existing
    ? await prisma.savedView.update({
        where: { id: existing.id },
        data: { name: n.data, filters: parsed.data },
        select: { id: true, name: true, scope: true, filters: true },
      })
    : await prisma.savedView.create({
        data: {
          userId: membership.userId,
          workspaceId: membership.workspaceId,
          scope: s.data,
          boardId: scopedBoardId,
          name: n.data,
          filters: parsed.data,
        },
        select: { id: true, name: true, scope: true, filters: true },
      });

  if (scopedBoardId) revalidatePath(`/boards/${scopedBoardId}`);
  else revalidatePath(s.data === QUERY_VIEW_SCOPE ? "/cards" : "/sprints");
  return { view: { ...view, filters: parseFilters(view.scope, view.filters) } };
}

export async function deleteSavedView(id: string) {
  const membership = await getActiveMembership();
  if (!membership) return { error: "Unauthorized." };
  // Scope the delete by owner so an id from another user is a no-op, not a delete.
  const res = await prisma.savedView.deleteMany({
    where: { id, userId: membership.userId, workspaceId: membership.workspaceId },
  });
  if (res.count === 0) return { error: "View not found." };
  return {};
}
