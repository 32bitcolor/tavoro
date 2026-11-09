// Encrypts a short secret (a Jira API token) for the little while a background job
// needs it. AES-256-GCM with a key derived from SESSION_SECRET, which both the app and
// the worker have. Not tagged "server-only": the worker (a plain tsx process) uses it.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error("SESSION_SECRET is not set.");
  return Buffer.from(hkdfSync("sha256", secret, "tavoro-secret-box", "jira-import-token", 32));
}

/** "v1.<iv>.<tag>.<ciphertext>", base64url. */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function open(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unreadable secret.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}
