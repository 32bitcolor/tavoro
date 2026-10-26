"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getWorkspaceAdmin } from "@/lib/dal";


const Kind = z.enum(["board", "storyboard", "project", "whiteboard"]);

/**
 * Grant or revoke a group's access to a single resource. Because access is
 * default-open, adding the FIRST grant to a resource restricts it to the granted
 * group(s) (plus admins); removing the last grant re-opens it to all members.
 */
export async function setGroupResourceAccess(
  groupId: string,
  kind: string,
  resourceId: string,
  granted: boolean,
) {
  const admin = await getWorkspaceAdmin();
  if (!admin) return { error: "You must be a workspace admin." };
  const parsedKind = Kind.safeParse(kind);
  if (!parsedKind.success) return { error: "Invalid resource type." };

  const group = await prisma.group.findFirst({
    where: { id: groupId, workspaceId: admin.workspaceId },
    select: { id: true },
  });
  if (!group) return { error: "Group not found." };

  // Verify the resource is in the same workspace, then upsert/delete the grant.
  if (parsedKind.data === "board") {
    const board = await prisma.board.findFirst({ where: { id: resourceId, workspaceId: admin.workspaceId }, select: { id: true } });
    if (!board) return { error: "Board not found." };
    if (granted) {
      await prisma.boardGroup.upsert({
        where: { boardId_groupId: { boardId: resourceId, groupId } },
        create: { boardId: resourceId, groupId },
        update: {},
      });
    } else {
      await prisma.boardGroup.delete({ where: { boardId_groupId: { boardId: resourceId, groupId } } }).catch(() => null);
    }
    revalidatePath(`/boards/${resourceId}`);
    revalidatePath("/boards");
  } else if (parsedKind.data === "storyboard") {
    const sb = await prisma.storyboard.findFirst({ where: { id: resourceId, workspaceId: admin.workspaceId }, select: { id: true } });
    if (!sb) return { error: "Storyboard not found." };
    if (granted) {
      await prisma.storyboardGroup.upsert({
        where: { storyboardId_groupId: { storyboardId: resourceId, groupId } },
        create: { storyboardId: resourceId, groupId },
        update: {},
      });
    } else {
      await prisma.storyboardGroup.delete({ where: { storyboardId_groupId: { storyboardId: resourceId, groupId } } }).catch(() => null);
    }
    revalidatePath(`/storyboards/${resourceId}`);
    revalidatePath("/storyboards");
  } else if (parsedKind.data === "project") {
    const project = await prisma.project.findFirst({ where: { id: resourceId, workspaceId: admin.workspaceId }, select: { id: true } });
    if (!project) return { error: "Project not found." };
    if (granted) {
      await prisma.projectGroup.upsert({
        where: { projectId_groupId: { projectId: resourceId, groupId } },
        create: { projectId: resourceId, groupId },
        update: {},
      });
    } else {
      await prisma.projectGroup.delete({ where: { projectId_groupId: { projectId: resourceId, groupId } } }).catch(() => null);
    }
    revalidatePath(`/projects/${resourceId}`);
    revalidatePath("/projects");
  } else {
    const wb = await prisma.whiteboard.findFirst({ where: { id: resourceId, workspaceId: admin.workspaceId }, select: { id: true } });
    if (!wb) return { error: "Whiteboard not found." };
    if (granted) {
      await prisma.whiteboardGroup.upsert({
        where: { whiteboardId_groupId: { whiteboardId: resourceId, groupId } },
        create: { whiteboardId: resourceId, groupId },
        update: {},
      });
    } else {
      await prisma.whiteboardGroup.delete({ where: { whiteboardId_groupId: { whiteboardId: resourceId, groupId } } }).catch(() => null);
    }
    revalidatePath(`/whiteboards/${resourceId}`);
    revalidatePath("/whiteboards");
  }

  revalidatePath(`/settings/groups/${groupId}`);
}
