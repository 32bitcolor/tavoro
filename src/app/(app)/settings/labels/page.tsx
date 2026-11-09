import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { Role } from "@/generated/prisma/client";
import { LabelsManager } from "@/components/settings/labels-manager";
import { EstimateUnitSetting } from "@/components/settings/estimate-unit-setting";
import { CustomFieldsManager } from "@/components/settings/custom-fields-manager";
import { asFieldType, asOptions } from "@/lib/custom-fields";

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

  const [fields, boards, uses] = await Promise.all([
    prisma.customField.findMany({
      where: { workspaceId: membership.workspaceId },
      orderBy: { position: "asc" },
      select: { id: true, name: true, type: true, options: true, allBoards: true, boards: { select: { boardId: true } } },
    }),
    prisma.board.findMany({ where: { workspaceId: membership.workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.cardFieldValue.groupBy({ by: ["fieldId"], where: { field: { workspaceId: membership.workspaceId } }, _count: { _all: true } }),
  ]);

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
      <CustomFieldsManager
        initial={fields.map((f) => ({ id: f.id, name: f.name, type: asFieldType(f.type), options: asOptions(f.options), allBoards: f.allBoards, boardIds: f.boards.map((b) => b.boardId) }))}
        boards={boards}
        uses={Object.fromEntries(uses.map((u) => [u.fieldId, u._count._all]))}
      />
    </div>
  );
}
