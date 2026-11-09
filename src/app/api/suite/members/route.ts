import { prisma } from "@/lib/db";
import { oauthError } from "@/lib/oauth";
import { authenticateApp } from "@/lib/connected-apps";

// The workspace's members, for a connected app to sync from (docs/SUITE.md): anyone
// not listed as active should be signed out there. Server to server, client secret.
export async function GET(req: Request) {
  const auth = await authenticateApp(req);
  if (!auth) return oauthError("invalid_client", "Client authentication failed.", 401);
  const [workspace, members] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: auth.app.workspaceId }, select: { id: true, name: true } }),
    prisma.membership.findMany({
      where: { workspaceId: auth.app.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { role: true, suspendedAt: true, user: { select: { id: true, email: true, name: true } } },
    }),
  ]);
  await prisma.connectedApp.update({ where: { id: auth.app.id }, data: { lastSyncAt: new Date() } });
  return Response.json(
    {
      workspace,
      app: { name: auth.app.name, url: auth.app.url },
      members: members.map((m) => ({ sub: m.user.id, email: m.user.email, name: m.user.name ?? m.user.email, role: m.role, active: !m.suspendedAt })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
