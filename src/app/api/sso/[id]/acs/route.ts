import { prisma } from "@/lib/db";
import { createSession } from "@/lib/session";
import { baseUrl } from "@/lib/oauth";
import { getConnection, isReady } from "@/lib/sso/connection";
import { firstUse, readProfile, samlFor } from "@/lib/sso/saml";
import { belongsElsewhere, fullName, ProvisionError, recomputeRoles, replaceGroupsFromAssertion, upsertMember } from "@/lib/sso/provision";
import { safeNextPath } from "@/lib/safe-next";

// The Assertion Consumer Service: the identity provider POSTs the signed response
// here, for both SP-initiated and IdP-initiated sign-in (docs/SSO.md).

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const base = baseUrl(req);
  const id = (await params).id;
  // Every refusal is logged with its reason: the sign-in page only shows the member a
  // short message, and the admin needs the detail.
  const fail = (code: string, detail = "") => {
    console.warn(`[sso] ${id}: sign-in refused (${code})${detail ? `: ${detail}` : ""}`);
    return Response.redirect(`${base}/login?sso=${code}`, 303);
  };
  const conn = await getConnection(id);
  if (!conn || !isReady(conn)) return fail("unavailable", conn ? "SSO is off or the IdP details are missing" : "no such connection");

  const form = await req.formData().catch(() => null);
  const samlResponse = form?.get("SAMLResponse");
  if (typeof samlResponse !== "string" || samlResponse.length > 500_000) return fail("invalid", "no SAMLResponse in the POST");
  const relay = form?.get("RelayState");

  let profile;
  try {
    const result = await samlFor(conn).validatePostResponseAsync({ SAMLResponse: samlResponse });
    profile = result.profile;
  } catch (e) {
    return fail("invalid", e instanceof Error ? e.message : String(e));
  }
  if (!profile) return fail("invalid", "no profile in the response");
  if (!(await firstUse(profile))) return fail("invalid", "assertion already used (replay)");

  const { email, given, family, groups: asserted } = readProfile(profile, conn.groupAttribute);
  // No group attribute: with SCIM on, SCIM owns group membership, so leave it be. With
  // SCIM off and roles from groups on, it means "no groups" (IdPs leave the attribute
  // out rather than send it empty), or a removed admin would stay one.
  const groups = asserted ?? (conn.manageRoles && !conn.scimEnabled ? [] : null);
  if (!email) return fail("noemail", `NameID ${profile.nameID ?? "(none)"}, attributes ${Object.keys(profile).filter((k) => !k.startsWith("get")).join(", ")}`);

  // The connection's email domains, when it has any, bound what its IdP may assert.
  const domain = email.toLowerCase().split("@")[1] ?? "";
  if (conn.domains.length && !conn.domains.includes(domain)) return fail("nodomain", `${email} is outside ${conn.domains.join(", ")}`);

  // Known here already, or allowed to be created on first sign-in?
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } });
  const member = user
    ? await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId: conn.workspaceId } }, select: { suspendedAt: true } })
    : null;
  if (member?.suspendedAt) return fail("suspended", email);
  if (user && (await belongsElsewhere(conn, user.id))) return fail("elsewhere", email);
  if (!member && !conn.jitProvisioning) return fail("notprovisioned", email);

  let userId: string;
  try {
    ({ userId } = await upsertMember(conn, { email, name: fullName(given, family) }));
    if (groups) {
      await replaceGroupsFromAssertion(conn, userId, groups);
      await recomputeRoles(conn, [userId]);
    }
  } catch (e) {
    return fail("invalid", `provisioning ${email} failed: ${e instanceof ProvisionError ? e.message : String(e)}`);
  }
  await prisma.ssoConnection.update({ where: { id: conn.id }, data: { lastLoginAt: new Date() } });
  await createSession(userId, conn.workspaceId, { sso: true });
  console.info(`[sso] ${conn.id}: signed in ${email}${groups ? ` (groups: ${groups.join(", ") || "none"})` : ""}`);
  const next = safeNextPath(relay) ?? "/dashboard";
  return Response.redirect(`${base}${next}`, 303);
}
