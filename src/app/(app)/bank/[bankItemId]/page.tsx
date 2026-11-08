import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { getBankItemForUser, projectVisibilityWhere } from "@/lib/authz";
import { BANK_SELECT, bankUsage, toBankRow } from "@/lib/bank-list";
import { BankDetail } from "@/components/bank/bank-detail";
import { PageContainer } from "@/components/shared/page";
import { Role } from "@/generated/prisma/client";

export const metadata = { title: "Question bank · Tavoro" };

export default async function BankItemPage({ params }: { params: Promise<{ bankItemId: string }> }) {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const { bankItemId } = await params;
  const access = await getBankItemForUser(bankItemId);
  if (!access || access.workspaceId !== membership.workspaceId) notFound();

  const visible = await projectVisibilityWhere();
  const [row, usage, projects, labels] = await Promise.all([
    prisma.bankItem.findUniqueOrThrow({ where: { id: bankItemId }, select: BANK_SELECT }),
    bankUsage(bankItemId, visible),
    prisma.project.findMany({ where: { workspaceId: membership.workspaceId, ...visible }, select: { id: true, name: true, status: true }, orderBy: { name: "asc" }, take: 1000 }),
    prisma.label.findMany({ where: { workspaceId: membership.workspaceId }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" } }),
  ]);
  const item = toBankRow(row);
  const manager = membership.role === Role.ADMIN || membership.role === Role.MANAGER;

  return (
    <PageContainer>
      <BankDetail
        item={{
          id: item.id,
          kind: item.kind,
          prompt: item.prompt,
          itemType: item.itemType,
          bloomLevel: item.bloomLevel,
          notes: item.notes,
          archived: !!item.archivedAt,
          createdBy: item.createdBy ? (item.createdBy.name ?? item.createdBy.email) : null,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          labelIds: item.labels.map((l) => l.id),
        }}
        usage={usage}
        projects={projects.map((p) => ({ id: p.id, label: p.name, hint: p.status === "on_hold" ? "On hold" : p.status === "completed" ? "Completed" : undefined }))}
        labels={labels}
        canDelete={manager || access.createdById === membership.userId}
      />
    </PageContainer>
  );
}
