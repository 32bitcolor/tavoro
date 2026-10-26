import "server-only";
import { prisma } from "@/lib/db";

export const CONN_SELECT = {
  id: true,
  workspaceId: true,
  enabled: true,
  idpEntityId: true,
  idpSsoUrl: true,
  idpCert: true,
  groupAttribute: true,
  jitProvisioning: true,
  manageRoles: true,
  defaultRole: true,
  scimEnabled: true,
  domains: true,
} as const;

/** A connection by id, if it exists (enabled or not). */
export function getConnection(id: string) {
  return prisma.ssoConnection.findUnique({ where: { id }, select: CONN_SELECT });
}

/** Ready for sign-in: switched on and configured. */
export function isReady(c: { enabled: boolean; idpSsoUrl: string | null; idpCert: string | null }) {
  return c.enabled && !!c.idpSsoUrl && !!c.idpCert;
}

/** The connection that signs in an email address, by its domain. */
export async function connectionForEmail(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  const c = await prisma.ssoConnection.findFirst({ where: { domains: { has: domain }, enabled: true }, select: CONN_SELECT });
  return c && isReady(c) ? c : null;
}

/** The workspace's connection, created (switched off) the first time it's needed. */
export function ensureConnection(workspaceId: string) {
  return prisma.ssoConnection.upsert({ where: { workspaceId }, create: { workspaceId }, update: {}, select: { id: true } });
}
