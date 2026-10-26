import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentPrincipal } from "@/lib/principal";
import { Role, type Prisma } from "@/generated/prisma/client";

// Data Access Layer — every protected read/mutation resolves identity through here.
// `cache` memoizes within a single render pass so repeated calls hit the DB once.

export const getCurrentUser = cache(async () => {
  const session = await getSession();
  if (!session?.userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, sessionsValidAfter: true },
  });
  if (!user) return null;
  // A cookie signed before the password last changed is void. (MCP tokens are
  // revoked on their own; their principal carries no `ts`.)
  const { sessionsValidAfter, ...rest } = user;
  if (sessionsValidAfter && !currentPrincipal() && (session.ts ?? 0) < sessionsValidAfter.getTime()) return null;
  return rest;
});

export const requireUser = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
});

/** Workspaces that require SSO are closed to a password session, except to their
 *  admins (the way back in if the identity provider is down). MCP tokens were issued
 *  from a session that passed this check, so they aren't held to it again. */
function ssoBlocks(): Prisma.MembershipWhereInput {
  return { NOT: { role: { not: Role.ADMIN }, workspace: { ssoConnection: { is: { enabled: true, requireSso: true } } } } };
}

/** The memberships this session may act through: not suspended, and not in a workspace
 *  whose SSO requirement it doesn't meet. Every access check starts from this. */
export async function usableMembershipWhere(): Promise<Prisma.MembershipWhereInput> {
  const session = await getSession();
  return { suspendedAt: null, ...(currentPrincipal() || session?.sso ? {} : ssoBlocks()) };
}

// A user's "active" workspace: the one pinned in their session if they're still a
// member, otherwise their oldest membership. (Most users have exactly one.)
export const getActiveMembership = cache(async () => {
  const user = await requireUser();
  const session = await getSession();
  const allowed = await usableMembershipWhere();
  if (session?.activeWorkspaceId) {
    const pinned = await prisma.membership.findFirst({
      where: { userId: user.id, workspaceId: session.activeWorkspaceId, ...allowed },
      include: { workspace: true },
    });
    if (pinned) return pinned;
    // An MCP token never falls back to another workspace.
    if (currentPrincipal()) return null;
  }
  return prisma.membership.findFirst({
    where: { userId: user.id, ...allowed },
    orderBy: { createdAt: "asc" },
    include: { workspace: true },
  });
});

/** The caller's membership if they administer their active workspace, else null.
 *  Workspace administration (members, groups, access, SSO, sharing, intake settings)
 *  happens in the browser only: an MCP connection never counts as an admin. */
export async function getWorkspaceAdmin() {
  if (currentPrincipal()) return null;
  const m = await getActiveMembership();
  return m?.role === Role.ADMIN ? m : null;
}

export async function requireAdmin() {
  const membership = await getActiveMembership();
  if (!membership || membership.role !== Role.ADMIN) {
    redirect("/dashboard");
  }
  return membership;
}
