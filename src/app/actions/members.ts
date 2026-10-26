"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, getWorkspaceAdmin } from "@/lib/dal";
import { hashPassword } from "@/lib/password";
import { createSession, sessionsCutoff } from "@/lib/session";
import { enqueueEmail } from "@/lib/queues";
import { memberWelcome, passwordReset, withLink } from "@/lib/email-templates";
import { appUrl } from "@/lib/app-url";
import { notificationsEnabled } from "@/lib/notify";
import { CreateUserSchema, ResetPasswordSchema } from "@/lib/validation";
import { Role } from "@/generated/prisma/client";
import type { FormState } from "@/lib/form-state";


/** Admin: create a workspace member with an admin-set initial password. */
export async function createUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await getWorkspaceAdmin();
  if (!admin) return { error: "You must be a workspace admin." };

  const parsed = CreateUserSchema.safeParse({
    name: formData.get("name") || undefined,
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  if (existing) {
    const already = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: existing.id, workspaceId: admin.workspaceId } },
      select: { userId: true },
    });
    if (already) return { error: "A user with that email is already in this workspace." };
    await prisma.membership.create({
      data: { userId: existing.id, workspaceId: admin.workspaceId, role: parsed.data.role },
    });
    revalidatePath("/settings/members");
    return { success: `Added ${email} to the workspace.` };
  }

  await prisma.user.create({
    data: {
      email,
      name: parsed.data.name || null,
      passwordHash: await hashPassword(parsed.data.password),
      memberships: { create: { workspaceId: admin.workspaceId, role: parsed.data.role } },
    },
  });
  revalidatePath("/settings/members");

  if (await notificationsEnabled(admin.workspaceId, "member")) {
    const inviter = await getCurrentUser();
    await enqueueEmail({
      to: email,
      ...withLink(
        memberWelcome({
          name: parsed.data.name || email,
          workspaceName: admin.workspace.name,
          inviterName: inviter?.name ?? inviter?.email ?? "an admin",
        }),
        appUrl("/login"),
      ),
    });
  }
  return { success: `Created ${email}. Share the password with them securely.` };
}

/** Admin: change a member's role, protecting the last admin. */
export async function setUserRole(userId: string, role: string) {
  const admin = await getWorkspaceAdmin();
  if (!admin) return { error: "You must be a workspace admin." };
  const parsed = z.enum(["ADMIN", "MANAGER", "MEMBER"]).safeParse(role);
  if (!parsed.success) return { error: "Invalid role." };

  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: admin.workspaceId } },
    select: { role: true },
  });
  if (!membership) return { error: "User not found in this workspace." };

  if (membership.role === Role.ADMIN && parsed.data !== "ADMIN") {
    const admins = await prisma.membership.count({
      where: { workspaceId: admin.workspaceId, role: Role.ADMIN, suspendedAt: null },
    });
    if (admins <= 1) return { error: "You can't demote the last admin." };
  }

  await prisma.membership.update({
    where: { userId_workspaceId: { userId, workspaceId: admin.workspaceId } },
    data: { role: parsed.data },
  });
  revalidatePath("/settings/members");
}

/** Admin: set a new password for a member (shared out-of-band). */
export async function resetUserPassword(userId: string, password: string): Promise<FormState> {
  const admin = await getWorkspaceAdmin();
  if (!admin) return { error: "You must be a workspace admin." };
  const parsed = ResetPasswordSchema.safeParse({ password });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: admin.workspaceId } },
    select: { userId: true },
  });
  if (!membership) return { error: "User not found in this workspace." };
  // An account in other workspaces too isn't this admin's to take over: setting its
  // password would open those workspaces to whoever knows it.
  const elsewhere = await prisma.membership.count({ where: { userId, workspaceId: { not: admin.workspaceId } } });
  if (elsewhere) return { error: "This person also belongs to another workspace, so only they can change their password." };

  // The old password's sessions and tokens stop working.
  const me = await getCurrentUser();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(parsed.data.password), sessionsValidAfter: sessionsCutoff() },
    }),
    prisma.apiToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  if (userId === me?.id) await createSession(userId, admin.workspaceId);

  if (userId !== me?.id && (await notificationsEnabled(admin.workspaceId, "member"))) {
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    if (target?.email) {
      await enqueueEmail({
        to: target.email,
        ...withLink(
          passwordReset({
            name: target.name ?? target.email,
            workspaceName: admin.workspace.name,
            adminName: me?.name ?? me?.email ?? "an admin",
          }),
          appUrl("/login"),
        ),
      });
    }
  }
  return { success: "Password reset. Share the new password securely." };
}

/**
 * Admin: remove a member from the workspace. Deletes the user record entirely if
 * they belong to no other workspace. Protects self-removal and the last admin.
 */
export async function removeUser(userId: string) {
  const admin = await getWorkspaceAdmin();
  if (!admin) return { error: "You must be a workspace admin." };
  if (userId === admin.userId) return { error: "You can't remove yourself." };

  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: admin.workspaceId } },
    select: { role: true },
  });
  if (!membership) return { error: "User not found in this workspace." };

  if (membership.role === Role.ADMIN) {
    const admins = await prisma.membership.count({
      where: { workspaceId: admin.workspaceId, role: Role.ADMIN, suspendedAt: null },
    });
    if (admins <= 1) return { error: "You can't remove the last admin." };
  }

  await prisma.membership.delete({
    where: { userId_workspaceId: { userId, workspaceId: admin.workspaceId } },
  });
  const remaining = await prisma.membership.count({ where: { userId } });
  if (remaining === 0) await prisma.user.delete({ where: { id: userId } });

  revalidatePath("/settings/members");
}

/** Admin: lift a suspension (one set by the identity provider, typically). */
export async function restoreUser(userId: string) {
  const admin = await getWorkspaceAdmin();
  if (!admin) return { error: "You must be a workspace admin." };
  const updated = await prisma.membership.updateMany({ where: { userId, workspaceId: admin.workspaceId }, data: { suspendedAt: null } });
  if (!updated.count) return { error: "User not found in this workspace." };
  revalidatePath("/settings/members");
}
