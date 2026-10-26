import { baseUrl } from "@/lib/oauth";
import { connectionForEmail } from "@/lib/sso/connection";
import { safeNextPath } from "@/lib/safe-next";

// "Sign in with SSO" on the sign-in page: a plain GET form posts here, and a real page
// navigation carries the browser on to the identity provider. (A server action can't:
// its redirect to an internal route is followed by fetch, which stops at the
// cross-site hop to the provider.)

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const base = baseUrl(req);
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") ?? "").trim();
  const next = url.searchParams.get("next") ?? "";
  const safeNext = safeNextPath(next, 1000) ?? "";
  const back = (code: string) => {
    const u = new URL("/login", base);
    u.searchParams.set("sso", code);
    if (email) u.searchParams.set("email", email.slice(0, 200));
    if (safeNext) u.searchParams.set("next", safeNext);
    return Response.redirect(u.toString(), 303);
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return back("noaddress");
  const conn = await connectionForEmail(email);
  if (!conn) return back("nodomain");
  return Response.redirect(`${base}/api/sso/${conn.id}/login${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`, 303);
}
