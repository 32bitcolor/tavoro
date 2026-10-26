import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, usableMembershipWhere } from "@/lib/dal";
import { decideAuthorization } from "@/app/actions/oauth";
import { normaliseScope } from "@/lib/api-tokens";
import { findClient } from "@/lib/oauth-cimd";
import { baseUrl, redirectAllowed, resourceAllowed } from "@/lib/oauth";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export const metadata = { title: "Connect an app · Tavoro" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/** OAuth consent (docs/MCP.md): an AI client asks to act as you in one workspace. */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const me = await requireUser();
  const clientId = one(sp.client_id);
  const redirectUri = one(sp.redirect_uri);
  const found = await findClient(clientId);
  const client = "error" in found ? null : found;

  // A bad client or redirect URI is shown here, never redirected to (RFC 6749 §4.1.2.1).
  if (!client || !redirectAllowed(client.redirectUris, redirectUri)) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <h2 className="text-lg font-medium">Can&apos;t connect</h2>
        <p className="text-muted-foreground">
          This connection request is invalid: {"error" in found ? found.error : "the app asked to return somewhere it didn't register."} Start
          again from the app.
        </p>
      </div>
    );
  }
  const fail = (error: string, description: string) => {
    const back = new URL(redirectUri);
    back.searchParams.set("error", error);
    back.searchParams.set("error_description", description);
    if (one(sp.state)) back.searchParams.set("state", one(sp.state));
    back.searchParams.set("iss", baseUrl()); // RFC 9207: errors carry the issuer too
    redirect(back.toString());
  };
  if (one(sp.response_type) !== "code" || one(sp.code_challenge_method) !== "S256" || !one(sp.code_challenge)) {
    fail("invalid_request", "response_type=code with a PKCE S256 code_challenge is required");
  }
  if (!resourceAllowed(one(sp.resource))) fail("invalid_target", "resource must be this server's MCP endpoint");

  const memberships = await prisma.membership.findMany({
    // A token skips the SSO check later, so only workspaces this session passes it for.
    where: { userId: me.id, ...(await usableMembershipWhere()) },
    orderBy: { createdAt: "asc" },
    select: { role: true, workspace: { select: { id: true, name: true } } },
  });
  const requested = one(sp.scope);
  const defaultAccess = requested && !requested.split(/\s+/).includes("write") ? "read" : normaliseScope("read write");
  const host = (() => {
    try {
      const u = new URL(redirectUri);
      return u.protocol.startsWith("http") ? u.host : u.protocol.replace(":", "");
    } catch {
      return redirectUri;
    }
  })();

  return (
    <form action={decideAuthorization} className="flex flex-col gap-4 text-sm">
      {(["client_id", "redirect_uri", "state", "code_challenge", "resource"] as const).map((k) => (
        <input key={k} type="hidden" name={k} value={one(sp[k])} />
      ))}
      <div>
        <h2 className="text-lg font-medium">Connect {client.name}?</h2>
        <p className="mt-1 text-muted-foreground">
          <span className="font-medium text-foreground">{client.name}</span> wants to use Tavoro as{" "}
          <span className="font-medium text-foreground">{me.name ?? me.email}</span>. It will see what you can see, and anything it does is
          recorded under your name.
        </p>
      </div>

      <label className="flex flex-col gap-1 font-medium">
        Workspace
        <Select name="workspace_id" defaultValue={memberships[0]?.workspace.id}>
          {memberships.map((m) => (
            <option key={m.workspace.id} value={m.workspace.id}>
              {m.workspace.name}
            </option>
          ))}
        </Select>
      </label>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 font-medium">Access</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="access" value="read write" defaultChecked={defaultAccess === "read write"} className="mt-0.5 accent-[var(--color-accent)]" />
          <span>
            Read and change
            <span className="block text-xs text-muted-foreground">Create and update cards, projects, storyboards, reviews and more.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="access" value="read" defaultChecked={defaultAccess === "read"} className="mt-0.5 accent-[var(--color-accent)]" />
          <span>
            Read only
            <span className="block text-xs text-muted-foreground">Look things up; change nothing.</span>
          </span>
        </label>
      </fieldset>

      <p className="text-xs text-muted-foreground">
        You&apos;ll return to <span className="font-mono">{host}</span>. You can disconnect it any time in Settings → AI &amp; MCP.
      </p>
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="allow" className="flex-1">
          Allow
        </Button>
        <Button type="submit" name="decision" value="deny" variant="outline" className="flex-1">
          Cancel
        </Button>
      </div>
    </form>
  );
}
