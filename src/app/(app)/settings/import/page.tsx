import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { Role } from "@/generated/prisma/client";
import { JiraConnect, JiraRunList } from "@/components/settings/jira-import";

export const metadata = { title: "Import · Tavoro" };

export default async function ImportSettingsPage() {
  const membership = await getActiveMembership();
  if (!membership || membership.role !== Role.ADMIN) redirect("/settings/account");
  const runs = await prisma.jiraImport.findMany({
    where: { workspaceId: membership.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, site: true, email: true, status: true, projects: true, createdAt: true, finishedAt: true, createdBy: { select: { name: true, email: true } } },
  });
  const last = runs[0];
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <JiraConnect defaultSite={last?.site ?? ""} defaultEmail={last?.email ?? ""} />
      <JiraRunList
        runs={runs.map((r) => ({
          id: r.id,
          site: r.site,
          status: r.status,
          projects: (r.projects as { key: string }[]).map((p) => p.key),
          createdAt: r.createdAt.toISOString(),
          by: r.createdBy?.name ?? r.createdBy?.email ?? null,
        }))}
      />
    </div>
  );
}
