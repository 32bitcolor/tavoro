import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { Role } from "@/generated/prisma/client";
import { ConnectedApps } from "@/components/settings/connected-apps";

export const metadata = { title: "Connected apps · Tavoro" };

export default async function ConnectedAppsPage() {
  const m = await getActiveMembership();
  if (!m || m.role !== Role.ADMIN) redirect("/settings/account");
  const apps = await prisma.connectedApp.findMany({
    where: { workspaceId: m.workspaceId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, url: true, secretHint: true, createdAt: true, lastUsedAt: true, lastSyncAt: true },
  });
  return (
    <ConnectedApps
      workspaceName={m.workspace.name}
      apps={apps.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), lastUsedAt: a.lastUsedAt?.toISOString() ?? null, lastSyncAt: a.lastSyncAt?.toISOString() ?? null }))}
    />
  );
}
