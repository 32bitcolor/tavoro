import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { Role } from "@/generated/prisma/client";
import { AutomationManager } from "@/components/settings/automation-manager";
import { Action, Trigger } from "@/lib/automation/rules";
import { asOptions } from "@/lib/custom-fields";

export const metadata = { title: "Automation · Tavoro" };

export default async function AutomationPage() {
  const m = await getActiveMembership();
  if (!m || m.role !== Role.ADMIN) redirect("/settings/account");
  const ws = m.workspaceId;
  const [rules, boards, statuses, labels, members, fields] = await Promise.all([
    prisma.automationRule.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "asc" }, include: { runs: { orderBy: { at: "desc" }, take: 1, select: { ok: true } } } }),
    prisma.board.findMany({ where: { workspaceId: ws }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.workspaceStatus.findMany({ where: { workspaceId: ws }, orderBy: { position: "asc" }, select: { name: true } }),
    prisma.label.findMany({ where: { workspaceId: ws }, orderBy: { name: "asc" }, select: { name: true } }),
    prisma.membership.findMany({ where: { workspaceId: ws, suspendedAt: null }, select: { user: { select: { name: true, email: true } } }, orderBy: { user: { name: "asc" } } }),
    prisma.customField.findMany({ where: { workspaceId: ws }, orderBy: { position: "asc" }, select: { name: true, type: true, options: true } }),
  ]);
  return (
    <AutomationManager
      rules={rules.map((r) => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        boardId: r.boardId,
        trigger: Trigger.safeParse(r.trigger).data ?? { kind: "card_created" },
        condition: r.condition,
        actions: (Array.isArray(r.actions) ? r.actions : []).flatMap((a) => {
          const p = Action.safeParse(a);
          return p.success ? [p.data] : [];
        }),
        lastRunAt: r.lastRunAt?.toISOString() ?? null,
        lastOk: r.runs[0]?.ok ?? null,
      }))}
      data={{
        boards,
        statuses,
        labels,
        members: members.map((x) => x.user),
        fields: fields.map((f) => ({ name: f.name, type: f.type, options: asOptions(f.options).map((o) => o.label) })),
      }}
    />
  );
}
