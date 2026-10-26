"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, usableMembershipWhere } from "@/lib/dal";
import { createSession } from "@/lib/session";

/** Pin a different workspace as active (the user must be a member of it). */
export async function switchWorkspace(workspaceId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, workspaceId, ...(await usableMembershipWhere()) },
    select: { id: true },
  });
  if (!membership) return;
  await createSession(user.id, workspaceId);
  redirect("/dashboard");
}
