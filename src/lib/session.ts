import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { currentPrincipal } from "@/lib/principal";

export const SESSION_COOKIE = "tavoro_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

// `sso`: this session began with a single sign-on assertion, which workspaces that
// require SSO insist on (docs/SSO.md).
// `ts` is when it was signed, in milliseconds (the standard `iat` is whole seconds),
// checked against User.sessionsValidAfter.
export type SessionPayload = { userId: string; activeWorkspaceId?: string; sso?: boolean; ts?: number };

function getKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Generate one with `openssl rand -base64 32`.");
  }
  return new TextEncoder().encode(secret);
}

export async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload, ts: Date.now() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getKey());
}

// Safe to call from Proxy (Node runtime) — only reads the token, no DB access.
export async function decrypt(token?: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getKey(), { algorithms: ["HS256"] });
    if (typeof payload.userId !== "string") return null;
    const active = typeof payload.activeWorkspaceId === "string" ? payload.activeWorkspaceId : undefined;
    // Sessions signed before `ts` existed fall back to `iat`.
    const ts = typeof payload.ts === "number" ? payload.ts : (payload.iat ?? 0) * 1000;
    return { userId: payload.userId, activeWorkspaceId: active, ts, ...(payload.sso === true ? { sso: true } : {}) };
  } catch {
    return null;
  }
}

/** `sso` says how this sign-in happened; left out (switching workspace, say), the
 *  current session's answer carries over for the same user. */
export async function createSession(userId: string, activeWorkspaceId?: string, opts: { sso?: boolean } = {}): Promise<void> {
  const cookieStore = await cookies();
  let sso = opts.sso;
  if (sso === undefined) {
    const current = await decrypt(cookieStore.get(SESSION_COOKIE)?.value);
    sso = current?.userId === userId && current.sso === true;
  }
  const token = await encrypt({
    userId,
    ...(activeWorkspaceId ? { activeWorkspaceId } : {}),
    ...(sso ? { sso: true } : {}),
  });
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  // An MCP request acts as its token's user, in its token's workspace.
  const principal = currentPrincipal();
  if (principal) return { userId: principal.userId, activeWorkspaceId: principal.workspaceId };
  const cookieStore = await cookies();
  return decrypt(cookieStore.get(SESSION_COOKIE)?.value);
}

/** The cutoff that voids every session the user has signed in with so far. */
export function sessionsCutoff(): Date {
  return new Date();
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
