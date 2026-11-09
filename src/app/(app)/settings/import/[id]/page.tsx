import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { Role } from "@/generated/prisma/client";
import { getJiraImport, jiraProjectDefaults } from "@/app/actions/jira-import";
import { JiraImportRun } from "@/components/settings/jira-import";

export const metadata = { title: "Jira import · Tavoro" };

export default async function JiraImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const membership = await getActiveMembership();
  if (!membership || membership.role !== Role.ADMIN) redirect("/settings/account");
  const run = await getJiraImport(id);
  if (!run) notFound();
  const [defaults, statuses, members] = await Promise.all([
    jiraProjectDefaults(id),
    prisma.workspaceStatus.findMany({ where: { workspaceId: membership.workspaceId }, orderBy: { position: "asc" }, select: { id: true, name: true, category: true } }),
    prisma.membership.findMany({
      where: { workspaceId: membership.workspaceId, suspendedAt: null },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);
  return (
    <JiraImportRun
      initial={run}
      defaults={defaults}
      statuses={statuses}
      members={members.map((m) => m.user)}
    />
  );
}
