"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { dummyHash, hashPassword, verifyPassword } from "@/lib/password";
import { checkThrottle, clientIp } from "@/lib/throttle";
import { createSession, deleteSession } from "@/lib/session";
import { SignupSchema, LoginSchema } from "@/lib/validation";
import { slugify } from "@/lib/slug";
import { workspaceStatusSeedData } from "@/lib/status";
import { signupOpen } from "@/lib/instance";
import { Role } from "@/generated/prisma/client";
import type { AuthState } from "@/lib/form-state";
import { safeNextPath } from "@/lib/safe-next";

async function uniqueWorkspaceSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const taken = await prisma.workspace.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!(await signupOpen())) return { error: "New accounts are created by a workspace admin. Ask yours to add you." };
  const parsed = SignupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    workspaceName: formData.get("workspaceName"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const { name, password, workspaceName } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return { error: "An account with that email already exists." };
  }

  const passwordHash = await hashPassword(password);
  const slug = await uniqueWorkspaceSlug(workspaceName);

  // First user of a new workspace is its ADMIN.
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      memberships: {
        create: {
          role: Role.ADMIN,
          workspace: { create: { name: workspaceName, slug } },
        },
      },
    },
    select: { id: true, memberships: { select: { workspaceId: true }, take: 1 } },
  });

  // Seed the new workspace's canonical status vocabulary.
  const workspaceId = user.memberships[0]?.workspaceId;
  if (workspaceId) {
    await prisma.workspaceStatus.createMany({ data: workspaceStatusSeedData(workspaceId) });
  }

  await createSession(user.id);
  redirect("/dashboard");
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const email = parsed.data.email.toLowerCase();
  // Slow down password guessing, from one network or against one account.
  const ip = await clientIp();
  const ipOk = await checkThrottle(`login-ip:${ip}`, 30, 900);
  const emailOk = await checkThrottle(`login-email:${email}`, 10, 900);
  if (!ipOk || !emailOk) return { error: "Too many sign-in attempts. Wait a few minutes and try again." };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  // Same message — and the same hashing work — whether the email is unknown or the
  // password is wrong, so neither reveals which accounts exist.
  const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash()), parsed.data.password);
  if (!user || !ok) {
    return { error: "Invalid email or password." };
  }

  // Suspended everywhere, or only in workspaces that require single sign-on?
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true, role: true, suspendedAt: true, workspace: { select: { ssoConnection: { select: { enabled: true, requireSso: true } } } } },
  });
  const active = memberships.filter((m) => !m.suspendedAt);
  if (memberships.length && !active.length) return { error: "Your access has been turned off. Ask your workspace admin." };
  const open = active.filter((m) => m.role === Role.ADMIN || !(m.workspace.ssoConnection?.enabled && m.workspace.ssoConnection.requireSso));
  if (active.length && !open.length) return { error: "Your workspace signs in with single sign-on. Choose “Sign in with SSO”." };

  await createSession(user.id, open[0]?.workspaceId, { sso: false });
  redirect(safeNextPath(formData.get("next")) ?? "/dashboard");
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}
