import "server-only";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";

// Instance-level rules, above any one workspace. A workspace admin runs their own
// workspace; only the instance owner may touch the server itself (Settings → Updates).

/** Self-service signup creates a new workspace with its creator as admin. It is open
 *  for the very first account (setting up a fresh install) and otherwise only when
 *  ALLOW_SIGNUP=true. People join an existing workspace by an admin adding them, or SSO. */
export async function signupOpen(): Promise<boolean> {
  if (process.env.ALLOW_SIGNUP === "true") return true;
  return (await prisma.user.count()) === 0;
}

/** INSTANCE_ADMIN_EMAILS (comma-separated) when set; otherwise the admins of the oldest
 *  workspace — the one created when the instance was set up. */
export async function isInstanceAdmin(userId: string): Promise<boolean> {
  const listed = (process.env.INSTANCE_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (listed.length) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return !!user && listed.includes(user.email.toLowerCase());
  }
  const first = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!first) return false;
  const m = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: first.id } },
    select: { role: true, suspendedAt: true },
  });
  return m?.role === Role.ADMIN && !m.suspendedAt;
}
