"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getWorkspaceAdmin } from "@/lib/dal";
import { GroupSchema } from "@/lib/validation";
import type { FormState } from "@/lib/form-state";


// Confirm a group belongs to the caller's workspace before mutating it.
async function groupInWorkspace(groupId: string, workspaceId: string) {
  return prisma.group.findFirst({ where: { id: groupId, workspaceId }, select: { id: true } });
}

export async function createGroup(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await getWorkspaceAdmin();
  if (!admin) return { error: "You must be a workspace admin." };

  const parsed = GroupSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const dupe = await prisma.group.findUnique({
    where: { workspaceId_name: { workspaceId: admin.workspaceId, name: parsed.data.name } },
    select: { id: true },
  });
  if (dupe) return { error: "A group with that name already exists." };

  await prisma.group.create({
    data: { workspaceId: admin.workspaceId, name: parsed.data.name, description: parsed.data.description || null },
  });
  revalidatePath("/settings/groups");
  return { success: `Group "${parsed.data.name}" created.` };
}

export async function renameGroup(groupId: string, name: string, description: string | null) {
  const admin = await getWorkspaceAdmin();
  if (!admin) return { error: "You must be a workspace admin." };
  if (!(await groupInWorkspace(groupId, admin.workspaceId))) return { error: "Group not found." };
  const parsed = GroupSchema.safeParse({ name, description: description || undefined });
  if (!parsed.success) return { error: "Group name is required." };

  const dupe = await prisma.group.findFirst({
    where: { workspaceId: admin.workspaceId, name: parsed.data.name, id: { not: groupId } },
    select: { id: true },
  });
  if (dupe) return { error: "A group with that name already exists." };

  await prisma.group.update({
    where: { id: groupId },
    data: { name: parsed.data.name, description: parsed.data.description || null },
  });
  revalidatePath("/settings/groups");
  revalidatePath(`/settings/groups/${groupId}`);
}

export async function deleteGroup(groupId: string) {
  const admin = await getWorkspaceAdmin();
  if (!admin) return { error: "You must be a workspace admin." };
  if (!(await groupInWorkspace(groupId, admin.workspaceId))) return { error: "Group not found." };
  // Cascades remove GroupMembership and the resource access grants for this group.
  await prisma.group.delete({ where: { id: groupId } });
  revalidatePath("/settings/groups");
}

export async function addGroupMember(groupId: string, userId: string) {
  const admin = await getWorkspaceAdmin();
  if (!admin) return { error: "You must be a workspace admin." };
  if (!(await groupInWorkspace(groupId, admin.workspaceId))) return { error: "Group not found." };

  // Only workspace members can be added to a group.
  const member = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: admin.workspaceId } },
    select: { userId: true },
  });
  if (!member) return { error: "That user isn't in this workspace." };

  await prisma.groupMembership.upsert({
    where: { groupId_userId: { groupId, userId } },
    create: { groupId, userId },
    update: {},
  });
  revalidatePath(`/settings/groups/${groupId}`);
}

export async function removeGroupMember(groupId: string, userId: string) {
  const admin = await getWorkspaceAdmin();
  if (!admin) return { error: "You must be a workspace admin." };
  if (!(await groupInWorkspace(groupId, admin.workspaceId))) return { error: "Group not found." };
  await prisma.groupMembership
    .delete({ where: { groupId_userId: { groupId, userId } } })
    .catch(() => null);
  revalidatePath(`/settings/groups/${groupId}`);
}
