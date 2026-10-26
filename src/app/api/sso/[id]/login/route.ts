import { getConnection, isReady } from "@/lib/sso/connection";
import { samlFor } from "@/lib/sso/saml";
import { baseUrl } from "@/lib/oauth";
import { safeNextPath } from "@/lib/safe-next";

// Start a sign-in at the identity provider (SP-initiated). `next` rides along as the
// RelayState and comes back with the assertion; only same-site paths are honoured.

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const base = baseUrl(req);
  const conn = await getConnection((await params).id);
  if (!conn || !isReady(conn)) return Response.redirect(`${base}/login?sso=unavailable`, 303);
  const next = new URL(req.url).searchParams.get("next") ?? "";
  const relay = safeNextPath(next, 1000) ?? "";
  const url = await samlFor(conn).getAuthorizeUrlAsync(relay, undefined, {});
  console.info(`[sso] ${conn.id}: sent a sign-in to the identity provider`);
  return Response.redirect(url, 303);
}
