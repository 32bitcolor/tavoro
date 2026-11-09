import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT } from "jose";
import { prisma } from "@/lib/db";
import { open } from "@/lib/secret-box";

// Connected apps (docs/SUITE.md): other apps in the suite sign people in with Tavoro.
// The flow is OpenID Connect's authorization code flow, kept deliberately small:
//   1. the app sends the browser to /suite/authorize (client_id, redirect_uri, state,
//      nonce, PKCE S256 code_challenge);
//   2. Tavoro checks the session and the workspace membership and returns a code;
//   3. the app trades it at /api/suite/token (client secret + code_verifier) for an
//      id_token: a JWT signed HS256 with the client secret (OIDC Core §10.1).
// The app also reads /api/suite/members every few minutes, so a member suspended or
// removed here is signed out there.

export const CODE_TTL_MS = 2 * 60 * 1000;
export const ID_TOKEN_TTL_S = 5 * 60;
export const KINDS = { courseforge: "CourseForge" } as const;

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export function newClientId() {
  return `tvapp_${randomBytes(12).toString("base64url")}`;
}

export function newSecret() {
  return `tvsec_${randomBytes(32).toString("base64url")}`;
}

/** A normalised https (or local http) base URL, or null. */
export function normaliseAppUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || process.env.CONNECTED_APPS_ALLOW_HTTP === "1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

export function redirectUriFor(app: { url: string }) {
  return `${app.url}/auth/tavoro/callback`;
}

/** What the admin pastes into the other app: everything it needs, in one string. */
export function connectionKey(tavoro: string, clientId: string, secret: string) {
  const json = JSON.stringify({ v: 1, tavoro, client_id: clientId, client_secret: secret });
  return `tavoro-connect:${Buffer.from(json).toString("base64url")}`;
}

/** HTTP Basic (or form) client credentials, checked against the sealed secret. */
export async function authenticateApp(req: Request, form?: Record<string, string>) {
  let id = form?.client_id;
  let secret = form?.client_secret;
  const m = /^Basic\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (m) {
    const raw = Buffer.from(m[1], "base64").toString("utf8");
    const i = raw.indexOf(":");
    id = decodeURIComponent(raw.slice(0, i));
    secret = decodeURIComponent(raw.slice(i + 1));
  }
  if (!id || !secret) return null;
  const app = await prisma.connectedApp.findUnique({ where: { clientId: id } });
  if (!app) return null;
  let real: string;
  try {
    real = open(app.secretSealed);
  } catch {
    return null;
  }
  const a = Buffer.from(sha256(secret));
  const b = Buffer.from(sha256(real));
  if (!timingSafeEqual(a, b)) return null;
  return { app, secret: real };
}

export async function signIdToken(
  issuer: string,
  secret: string,
  claims: { aud: string; sub: string; nonce: string; email: string; name: string | null; role: string; workspace: { id: string; name: string } },
) {
  const { aud, sub, ...rest } = claims;
  return new SignJWT({ ...rest, name: rest.name ?? rest.email, email_verified: true })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(aud)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(`${ID_TOKEN_TTL_S}s`)
    .sign(new TextEncoder().encode(secret));
}

/** The workspace's connected apps, for the sidebar's app switcher. */
export async function suiteLinks(workspaceId: string) {
  return prisma.connectedApp.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" }, select: { name: true, url: true } });
}

/** A two-minute, one-time sign-in code for a member (stored hashed). */
export async function issueCode(appId: string, userId: string, nonce: string, codeChallenge: string) {
  const code = `tvac_${randomBytes(32).toString("base64url")}`;
  await prisma.connectedAppCode.create({ data: { codeHash: sha256(code), appId, userId, nonce, codeChallenge, expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
  return code;
}
