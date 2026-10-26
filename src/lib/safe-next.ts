/** A same-site path to go to after signing in, or null. Anything that could leave the
 *  site — "//evil.com", "/\evil.com", a full URL — is refused, so a `next` or
 *  RelayState parameter can't send someone elsewhere. */
export function safeNextPath(raw: unknown, maxLength = 2000): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw.length <= maxLength ? raw : null;
}
