import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { Role } from "@/generated/prisma/client";

// Members as the identity provider sees them (docs/SSO.md). SCIM and SAML sign-in
// both come through here, so a member provisioned either way ends up the same: a
// Tavoro user, a membership in the connection's workspace, and an SsoIdentity
// linking the two. Deactivating suspends the membership and keeps the member's work.

export type Conn = { id: string; workspaceId: string; manageRoles: boolean; defaultRole: Role };

export class ProvisionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
    readonly scimType?: string,
  ) {
    super(message);
  }
}

const RANK: Record<Role, number> = { ADMIN: 3, MANAGER: 2, MEMBER: 1 };

export function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function fullName(given?: string | null, family?: string | null, display?: string | null): string | null {
  const joined = [given, family].filter((x) => x && x.trim()).join(" ").trim();
  return (display?.trim() || joined || null)?.slice(0, 120) ?? null;
}

async function activeAdmins(workspaceId: string, exceptUserId?: string) {
  return prisma.membership.count({
    where: { workspaceId, role: Role.ADMIN, suspendedAt: null, ...(exceptUserId ? { userId: { not: exceptUserId } } : {}) },
  });
}

/** One workspace's identity provider may only speak for accounts that belong to no
 *  other workspace. Otherwise any workspace admin could point SSO (or SCIM) at an IdP
 *  they control, assert someone else's email, and sign in as them. */
export async function belongsElsewhere(conn: Conn, userId: string): Promise<boolean> {
  return (await prisma.membership.count({ where: { userId, workspaceId: { not: conn.workspaceId } } })) > 0;
}

const ELSEWHERE = "That email belongs to a Tavoro account in another workspace, so this workspace's identity provider can't sign it in or manage it.";

/** Link (or create) the member for an identity the provider sent. */
export async function upsertMember(
  conn: Conn,
  input: { email: string; name: string | null; externalId?: string | null; active?: boolean },
  opts: { identityId?: string } = {},
) {
  const email = normEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ProvisionError("userName must be an email address.", 400, "invalidValue");

  let user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
  let created = false;
  if (!user) {
    // No password anyone knows: an SSO member signs in through the provider. An admin
    // can still set one in Settings → Members as a break-glass.
    user = await prisma.user.create({
      data: { email, name: input.name, passwordHash: await hashPassword(randomBytes(32).toString("base64url")) },
      select: { id: true, name: true },
    });
    created = true;
  } else if (await belongsElsewhere(conn, user.id)) {
    throw new ProvisionError(ELSEWHERE, 409, "uniqueness");
  } else if (input.name && input.name !== user.name) {
    await prisma.user.update({ where: { id: user.id }, data: { name: input.name } });
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: conn.workspaceId } },
    select: { suspendedAt: true },
  });
  if (!membership) {
    await prisma.membership.create({
      data: { userId: user.id, workspaceId: conn.workspaceId, role: conn.defaultRole, suspendedAt: input.active === false ? new Date() : null },
    });
  }

  const identity = await prisma.ssoIdentity.upsert({
    where: { connectionId_userId: { connectionId: conn.id, userId: user.id } },
    create: { connectionId: conn.id, userId: user.id, userName: email, externalId: input.externalId ?? null, active: input.active !== false },
    update: { userName: email, ...(input.externalId !== undefined ? { externalId: input.externalId } : {}) },
    select: { id: true },
  });
  if (opts.identityId && opts.identityId !== identity.id) throw new ProvisionError("That email belongs to another provisioned user.", 409, "uniqueness");
  if (membership && input.active !== undefined) await setActive(conn, user.id, input.active);
  if (conn.manageRoles) await recomputeRoles(conn, [user.id]);
  return { userId: user.id, identityId: identity.id, created };
}

/** Change a provisioned member's email (the SCIM userName). */
export async function changeEmail(conn: Conn, userId: string, email: string) {
  const next = normEmail(email);
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!me || me.email === next) return;
  if (await belongsElsewhere(conn, userId)) throw new ProvisionError(ELSEWHERE, 409, "uniqueness");
  const taken = await prisma.user.findUnique({ where: { email: next }, select: { id: true } });
  if (taken) throw new ProvisionError("Another Tavoro user already has that email.", 409, "uniqueness");
  await prisma.user.update({ where: { id: userId }, data: { email: next } });
  await prisma.ssoIdentity.update({ where: { connectionId_userId: { connectionId: conn.id, userId } }, data: { userName: next } });
}

/** Suspend or restore a member. The last active admin can't be suspended. */
export async function setActive(conn: Conn, userId: string, active: boolean) {
  const m = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: conn.workspaceId } },
    select: { role: true, suspendedAt: true },
  });
  if (!m) return;
  if (!active && !m.suspendedAt && m.role === Role.ADMIN && (await activeAdmins(conn.workspaceId, userId)) === 0) {
    throw new ProvisionError("Tavoro won't deactivate the workspace's last active admin.", 400, "mutability");
  }
  if (active === !m.suspendedAt) {
    await prisma.ssoIdentity.updateMany({ where: { connectionId: conn.id, userId }, data: { active } });
    return;
  }
  await prisma.membership.update({
    where: { userId_workspaceId: { userId, workspaceId: conn.workspaceId } },
    data: { suspendedAt: active ? null : new Date() },
  });
  await prisma.ssoIdentity.updateMany({ where: { connectionId: conn.id, userId }, data: { active } });
  // A suspended member's API tokens and connected apps stop at once.
  if (!active) await prisma.apiToken.updateMany({ where: { userId, workspaceId: conn.workspaceId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Set each member's role from their groups: the highest role any mapped group grants,
 *  or the default when none does. Never demotes the last active admin. */
export async function recomputeRoles(conn: Conn, userIds: string[]) {
  if (!conn.manageRoles || !userIds.length) return;
  const mappings = await prisma.ssoRoleMapping.findMany({ where: { connectionId: conn.id }, select: { groupName: true, role: true } });
  const byName = new Map(mappings.map((m) => [m.groupName.toLowerCase(), m.role]));
  for (const userId of new Set(userIds)) {
    const groups = await prisma.idpGroupMember.findMany({
      where: { userId, group: { connectionId: conn.id } },
      select: { group: { select: { displayName: true } } },
    });
    let role: Role = conn.defaultRole;
    for (const g of groups) {
      const r = byName.get(g.group.displayName.toLowerCase());
      if (r && RANK[r] > RANK[role]) role = r;
    }
    const m = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: conn.workspaceId } },
      select: { role: true, suspendedAt: true },
    });
    if (!m || m.role === role) continue;
    if (m.role === Role.ADMIN && !m.suspendedAt && (await activeAdmins(conn.workspaceId, userId)) === 0) continue;
    await prisma.membership.update({ where: { userId_workspaceId: { userId, workspaceId: conn.workspaceId } }, data: { role } });
  }
}

/** Everyone in the workspace the provider manages, re-evaluated (after mappings change). */
export async function recomputeAll(conn: Conn) {
  const ids = await prisma.ssoIdentity.findMany({ where: { connectionId: conn.id }, select: { userId: true } });
  await recomputeRoles(conn, ids.map((i) => i.userId));
}

/** A SAML sign-in's group list becomes the member's groups for this connection. */
export async function replaceGroupsFromAssertion(conn: Conn, userId: string, names: string[]) {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean).map((n) => n.slice(0, 200)))];
  const groups = [];
  for (const displayName of clean) {
    groups.push(
      await prisma.idpGroup.upsert({
        where: { connectionId_displayName: { connectionId: conn.id, displayName } },
        create: { connectionId: conn.id, displayName },
        update: {},
        select: { id: true },
      }),
    );
  }
  const keep = groups.map((g) => g.id);
  await prisma.idpGroupMember.deleteMany({ where: { userId, group: { connectionId: conn.id }, groupId: { notIn: keep } } });
  if (keep.length) await prisma.idpGroupMember.createMany({ data: keep.map((groupId) => ({ groupId, userId })), skipDuplicates: true });
}
