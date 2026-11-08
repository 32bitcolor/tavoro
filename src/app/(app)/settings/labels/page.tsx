import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { Role } from "@/generated/prisma/client";
import { LabelsManager } from "@/components/settings/labels-manager";
import { EstimateUnitSetting } from "@/components/settings/estimate-unit-setting";

export const metadata = { title: "Cards & labels · Tavoro" };

export default async function LabelsPage() {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  if (membership.role !== Role.ADMIN) redirect("/settings/account");

  const workspace = await prisma.workspace.findUnique({ where: { id: membership.workspaceId }, select: { estimateUnit: true } });
  const labels = await prisma.label.findMany({
    where: { workspaceId: membership.workspaceId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true, _count: { select: { cards: true } } },
  });

  const rows = labels.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    uses: l._count.cards,
  }));

  return (
    <div className="flex flex-col gap-8">
      <EstimateUnitSetting initial={workspace?.estimateUnit === "hours" ? "hours" : "points"} />
      <LabelsManager labels={rows} />
    </div>
  );
}
