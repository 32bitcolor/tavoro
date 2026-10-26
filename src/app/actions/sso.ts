"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getWorkspaceAdmin } from "@/lib/dal";
import { newSecret, sha256 } from "@/lib/api-tokens";
import { parseIdpMetadata, splitPem } from "@/lib/sso/metadata";
import { recomputeAll } from "@/lib/sso/provision";

// Settings → Single sign-on (docs/SSO.md). Admins only, and only from the browser:
// an MCP connection can't change how people sign in.


function done() {
  revalidatePath("/settings/sso");
  return { ok: true as const };
}

export async function saveIdentityProvider(input: { metadataXml?: string; entityId?: string; ssoUrl?: string; cert?: string }) {
  const m = await getWorkspaceAdmin();
  if (!m) return { error: "Only admins can change single sign-on." };
  let idp: { entityId: string; ssoUrl: string; certs: string[] };
  if (input.metadataXml?.trim()) {
    const parsed = parseIdpMetadata(input.metadataXml.trim());
    if ("error" in parsed) return { error: parsed.error };
    idp = parsed;
  } else {
    const certs = splitPem(input.cert ?? "");
    const ssoUrl = (input.ssoUrl ?? "").trim();
    if (!/^https:\/\//.test(ssoUrl)) return { error: "The IdP sign-in URL must start with https://." };
    if (!certs.length) return { error: "Paste the IdP's signing certificate (PEM)." };
    idp = { entityId: (input.entityId ?? "").trim(), ssoUrl, certs };
  }
  await prisma.ssoConnection.upsert({
    where: { workspaceId: m.workspaceId },
    create: { workspaceId: m.workspaceId, idpEntityId: idp.entityId || null, idpSsoUrl: idp.ssoUrl, idpCert: idp.certs.join("\n") },
    update: { idpEntityId: idp.entityId || null, idpSsoUrl: idp.ssoUrl, idpCert: idp.certs.join("\n") },
  });
  return done();
}

const Options = z.object({
  enabled: z.boolean(),
  domains: z.array(z.string()).max(20),
  groupAttribute: z.string().trim().min(1).max(200),
  jitProvisioning: z.boolean(),
  requireSso: z.boolean(),
});

export async function saveSsoOptions(input: z.input<typeof Options>) {
  const m = await getWorkspaceAdmin();
  if (!m) return { error: "Only admins can change single sign-on." };
  const parsed = Options.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the settings." };
  const o = parsed.data;
  const domains = [...new Set(o.domains.map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];
  const bad = domains.find((d) => !/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(d));
  if (bad) return { error: `"${bad}" isn't a domain name.` };
  const conn = await prisma.ssoConnection.findUnique({ where: { workspaceId: m.workspaceId }, select: { id: true, idpSsoUrl: true, idpCert: true } });
  if (!conn) return { error: "Set up the identity provider first." };
  if (o.enabled && (!conn.idpSsoUrl || !conn.idpCert)) return { error: "Add the identity provider's details before turning sign-in on." };
  if (o.requireSso && !o.enabled) return { error: "Turn single sign-on on before requiring it." };
  // A domain routes to one workspace's provider; two can't both claim it.
  const clash = await prisma.ssoConnection.findFirst({ where: { id: { not: conn.id }, domains: { hasSome: domains } }, select: { domains: true } });
  if (clash) return { error: `${clash.domains.find((d) => domains.includes(d))} is already used by another workspace's single sign-on.` };
  await prisma.ssoConnection.update({
    where: { id: conn.id },
    data: { enabled: o.enabled, domains, groupAttribute: o.groupAttribute, jitProvisioning: o.jitProvisioning, requireSso: o.requireSso },
  });
  return done();
}

/** A new SCIM token, shown once. Replaces any earlier one immediately. */
export async function createScimToken() {
  const m = await getWorkspaceAdmin();
  if (!m) return { error: "Only admins can change provisioning." };
  const token = newSecret("tavscim_");
  await prisma.ssoConnection.upsert({
    where: { workspaceId: m.workspaceId },
    create: { workspaceId: m.workspaceId, scimEnabled: true, scimTokenHash: sha256(token), scimTokenHint: token.slice(-4) },
    update: { scimEnabled: true, scimTokenHash: sha256(token), scimTokenHint: token.slice(-4) },
  });
  revalidatePath("/settings/sso");
  return { token };
}

export async function setScimEnabled(enabled: boolean) {
  const m = await getWorkspaceAdmin();
  if (!m) return { error: "Only admins can change provisioning." };
  const conn = await prisma.ssoConnection.findUnique({ where: { workspaceId: m.workspaceId }, select: { id: true, scimTokenHash: true } });
  if (!conn?.scimTokenHash && enabled) return { error: "Create a SCIM token first." };
  if (conn) await prisma.ssoConnection.update({ where: { id: conn.id }, data: { scimEnabled: enabled, ...(enabled ? {} : { scimTokenHash: null, scimTokenHint: null }) } });
  return done();
}

const Roles = z.object({
  manageRoles: z.boolean(),
  defaultRole: z.enum(["ADMIN", "MANAGER", "MEMBER"]),
  mappings: z.array(z.object({ groupName: z.string().trim().min(1).max(200), role: z.enum(["ADMIN", "MANAGER", "MEMBER"]) })).max(100),
});

export async function saveRoleMappings(input: z.input<typeof Roles>) {
  const m = await getWorkspaceAdmin();
  if (!m) return { error: "Only admins can change role mapping." };
  const parsed = Roles.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the mappings." };
  const r = parsed.data;
  const seen = new Set<string>();
  for (const x of r.mappings) {
    if (seen.has(x.groupName.toLowerCase())) return { error: `"${x.groupName}" is mapped twice.` };
    seen.add(x.groupName.toLowerCase());
  }
  // Mapping only to Member, with Admin by default, is almost certainly a slip.
  if (r.manageRoles && r.defaultRole === "ADMIN") return { error: "Use Member or Manager as the default; make admins through a group." };
  const conn = await prisma.ssoConnection.upsert({
    where: { workspaceId: m.workspaceId },
    create: { workspaceId: m.workspaceId, manageRoles: r.manageRoles, defaultRole: r.defaultRole },
    update: { manageRoles: r.manageRoles, defaultRole: r.defaultRole },
    select: { id: true, workspaceId: true, manageRoles: true, defaultRole: true },
  });
  await prisma.$transaction([
    prisma.ssoRoleMapping.deleteMany({ where: { connectionId: conn.id } }),
    prisma.ssoRoleMapping.createMany({ data: r.mappings.map((x) => ({ connectionId: conn.id, groupName: x.groupName, role: x.role })) }),
  ]);
  await recomputeAll(conn);
  revalidatePath("/settings/members");
  return done();
}
