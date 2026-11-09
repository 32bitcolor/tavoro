import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, usableMembershipWhere } from "@/lib/dal";
import { issueCode, redirectUriFor } from "@/lib/connected-apps";

export const metadata = { title: "Sign in · Tavoro" };

// Sign-in for a connected app (docs/SUITE.md). No consent screen: an admin connected
// the app to this workspace, so being a member of it is the permission. A page, not a
// route handler: after the login form's server action, the client router follows to
// here, and only a page's redirect() to another site becomes a real browser navigation.

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

async function base() {
  const env = process.env.APP_URL?.replace(/\/+$/, "");
  if (env) return env;
  const h = await headers();
  return `${h.get("x-forwarded-proto")?.split(",")[0] ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

function Problem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-muted-foreground">{children}</p>
      <Link href="/dashboard" className="mt-2 text-accent hover:underline">
        Go to Tavoro
      </Link>
    </div>
  );
}

export default async function SuiteAuthorizePage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const app = await prisma.connectedApp.findUnique({ where: { clientId: one(sp.client_id) }, include: { workspace: { select: { name: true } } } });
  // Unknown app or a redirect it didn't register: shown here, never redirected to.
  if (!app || one(sp.redirect_uri) !== redirectUriFor(app)) {
    return <Problem title="Can’t sign you in">This sign-in link isn’t from an app connected to Tavoro. Start again from the app.</Problem>;
  }
  const iss = await base();
  const back = (params: Record<string, string>) => {
    const u = new URL(redirectUriFor(app));
    if (one(sp.state)) u.searchParams.set("state", one(sp.state));
    u.searchParams.set("iss", iss);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  };
  const challenge = one(sp.code_challenge);
  const nonce = one(sp.nonce);
  if (one(sp.response_type) !== "code" || one(sp.code_challenge_method) !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !nonce || nonce.length > 200) {
    redirect(back({ error: "invalid_request" }));
  }

  const me = await getCurrentUser();
  if (!me) {
    const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
    redirect(`/login?next=${encodeURIComponent(`/suite/authorize?${q}`)}`);
  }
  const member = await prisma.membership.findFirst({ where: { userId: me.id, workspaceId: app.workspaceId, ...(await usableMembershipWhere()) }, select: { id: true } });
  if (!member) {
    const any = await prisma.membership.findFirst({ where: { userId: me.id, workspaceId: app.workspaceId, suspendedAt: null }, select: { id: true } });
    return any ? (
      <Problem title="Sign in with single sign-on first">
        {app.workspace.name} requires single sign-on. Sign out of Tavoro, sign in with your company account, then open {app.name} again.
      </Problem>
    ) : (
      <Problem title={`No access to ${app.name}`}>
        You’re signed in to Tavoro as {me.email}, but {app.name} is connected to the {app.workspace.name} workspace, which you aren’t a member of. Ask its admin to add you.
      </Problem>
    );
  }

  redirect(back({ code: await issueCode(app.id, me.id, nonce, challenge) }));
}
