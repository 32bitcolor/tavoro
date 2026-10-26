import { NextResponse, type NextRequest } from "next/server";
import { decrypt, SESSION_COOKIE } from "@/lib/session";

// Next.js 16: "Middleware" is now "Proxy" (same functionality).
// Optimistic auth gate only — the real authorization happens in the DAL,
// close to the data. Here we just pre-filter obvious unauthenticated access.

const PUBLIC_ROUTES = ["/login", "/signup"];
// Reachable with no session at all: the public intake form (/request/<workspace-slug>),
// where external stakeholders submit requests, and guest review links (/review/…),
// where outside SMEs review one round. Note "/review/" doesn't match "/reviews/".
// Public board links (/share/b/<token>) show one board, read-only, and requester status
// pages (/status/<token>) show one intake request to the person who sent it.
const PUBLIC_PREFIXES = ["/request/", "/review/", "/share/", "/status/"];

// Hostnames the app used to live at (e.g. before the rename to Tavoro). Page visits
// there redirect to the same path on APP_URL; API calls and OAuth discovery are
// excluded by the matcher and keep working, so existing MCP connections don't break.
const LEGACY_HOSTS = (process.env.LEGACY_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (LEGACY_HOSTS.includes(host) && process.env.APP_URL) {
    return NextResponse.redirect(new URL(pathname + req.nextUrl.search, process.env.APP_URL), 308);
  }
  const session = await decrypt(req.cookies.get(SESSION_COOKIE)?.value);
  const isAuthPage = PUBLIC_ROUTES.includes(pathname);
  const isPublic = isAuthPage || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!session && !isPublic && pathname !== "/") {
    const login = new URL("/login", req.url);
    // Come back here after signing in (the OAuth consent page relies on it).
    if (req.method === "GET") login.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }

  // A signed-in visitor to /login or /signup is sent on by those pages themselves, not
  // here: only the DAL knows whether a validly signed cookie still counts (the password
  // may have changed, or the account gone), and bouncing on the signature alone would
  // loop between /login and /dashboard.

  const res = NextResponse.next();
  // Guest review pages and public boards: keep the page URL out of Referer headers and
  // search engines.
  if (pathname.startsWith("/review/") || pathname.startsWith("/share/") || pathname.startsWith("/status/")) {
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return res;
}

export const config = {
  // Skip API routes, Next internals, and anything with a file extension.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
