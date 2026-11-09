import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { PageContainer, PageHeader } from "@/components/shared/page";
import Link from "next/link";
import { ListOrdered } from "lucide-react";
import { SprintsManager } from "@/components/sprint/sprints-manager";
import { asSprintReport } from "@/lib/sprint";

export const metadata = { title: "Sprints · Tavoro" };

export default async function SprintsPage() {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");

  const sprints = await prisma.sprint.findMany({
    where: { workspaceId: membership.workspaceId },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      goal: true,
      status: true,
      startDate: true,
      endDate: true,
      report: true,
      _count: { select: { cards: true } },
    },
  });
  const [totals, workspace] = await Promise.all([
    prisma.card.groupBy({ by: ["sprintId"], where: { sprintId: { in: sprints.map((s) => s.id) } }, _sum: { estimate: true } }),
    prisma.workspace.findUnique({ where: { id: membership.workspaceId }, select: { estimateUnit: true } }),
  ]);
  const estimateOf = new Map(totals.map((t) => [t.sprintId, t._sum.estimate ?? 0]));

  const initial = sprints.map((s) => ({
    id: s.id,
    name: s.name,
    goal: s.goal,
    status: s.status,
    startDate: s.startDate ? s.startDate.toISOString().slice(0, 10) : null,
    endDate: s.endDate ? s.endDate.toISOString().slice(0, 10) : null,
    cardCount: s._count.cards,
    estimate: estimateOf.get(s.id) ?? 0,
    report: asSprintReport(s.report),
  }));

  return (
    <PageContainer>
      <PageHeader
        title="Sprints"
        description="Plan time-boxed sprints across projects, then open the board to run them."
        actions={
          <Link
            href="/sprints/backlog"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-hover"
          >
            <ListOrdered className="size-4" aria-hidden="true" />
            Backlog
          </Link>
        }
      />
      {/* Remount when a sprint starts or completes elsewhere (e.g. after Complete sprint refreshes). */}
      <SprintsManager key={initial.map((s) => `${s.id}:${s.status}`).join(",")} initial={initial} estimateUnit={workspace?.estimateUnit === "hours" ? "hours" : "points"} />
    </PageContainer>
  );
}
