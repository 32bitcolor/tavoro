import { prisma } from "@/lib/db";
import { baseUrl, oauthError, pkceMatches, readParams } from "@/lib/oauth";
import { authenticateApp, ID_TOKEN_TTL_S, redirectUriFor, sha256, signIdToken } from "@/lib/connected-apps";

// A connected app trades a sign-in code for an id_token (docs/SUITE.md). Server to
// server only: no CORS headers, and the client secret is required.
export async function POST(req: Request) {
  const p = await readParams(req);
  const auth = await authenticateApp(req, p);
  if (!auth) return oauthError("invalid_client", "Client authentication failed.", 401);
  if (p.grant_type !== "authorization_code") return oauthError("unsupported_grant_type", "Use authorization_code.");
  if (!p.code || !p.code_verifier) return oauthError("invalid_request", "code and code_verifier are required.");
  if (p.redirect_uri && p.redirect_uri !== redirectUriFor(auth.app)) return oauthError("invalid_grant", "redirect_uri doesn't match.");

  const code = await prisma.connectedAppCode.findUnique({ where: { codeHash: sha256(p.code) } });
  if (!code || code.usedAt || code.expiresAt.getTime() < Date.now()) return oauthError("invalid_grant", "The code is invalid, used or expired.");
  // Spend it first: a code works once, even if the rest of this request fails.
  const spent = await prisma.connectedAppCode.updateMany({ where: { id: code.id, usedAt: null }, data: { usedAt: new Date() } });
  if (spent.count !== 1) return oauthError("invalid_grant", "The code was already used.");
  if (code.appId !== auth.app.id) return oauthError("invalid_grant", "The code was issued to another app.");
  if (!pkceMatches(p.code_verifier, code.codeChallenge)) return oauthError("invalid_grant", "PKCE verification failed.");

  const member = await prisma.membership.findFirst({
    where: { userId: code.userId, workspaceId: auth.app.workspaceId, suspendedAt: null },
    select: { role: true, user: { select: { id: true, email: true, name: true } }, workspace: { select: { id: true, name: true } } },
  });
  if (!member) return oauthError("invalid_grant", "That person is no longer a member of the workspace.");

  const idToken = await signIdToken(baseUrl(req), auth.secret, {
    aud: auth.app.clientId,
    sub: member.user.id,
    nonce: code.nonce,
    email: member.user.email,
    name: member.user.name,
    role: member.role,
    workspace: member.workspace,
  });
  await prisma.connectedApp.update({ where: { id: auth.app.id }, data: { lastUsedAt: new Date() } });
  // Old codes are only clutter: clear this app's spent and expired ones.
  await prisma.connectedAppCode.deleteMany({ where: { appId: auth.app.id, OR: [{ usedAt: { not: null } }, { expiresAt: { lt: new Date() } }] } });
  return Response.json({ id_token: idToken, token_type: "Bearer", expires_in: ID_TOKEN_TTL_S }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}
