import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { queryContext, runQuery } from "@/lib/query/run";
import { DEFAULT_QUERY } from "@/lib/query/compile";
import { CardsView } from "@/components/cards/cards-view";

export const metadata = { title: "Cards · Tavoro" };

export default async function CardsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const m = await getActiveMembership();
  if (!m) redirect("/login");
  const sp = await searchParams;
  const q = sp.q ?? DEFAULT_QUERY;
  const page = Math.max(0, Number(sp.page) || 0);
  const [ctx, result, ws] = await Promise.all([
    queryContext(m.workspaceId, m.userId),
    runQuery(m.workspaceId, m.userId, q, page),
    prisma.workspace.findUnique({ where: { id: m.workspaceId }, select: { estimateUnit: true } }),
  ]);
  return (
    <CardsView
      initialQuery={q}
      initialPage={page}
      initialResult={result}
      estimateUnit={ws?.estimateUnit === "hours" ? "hours" : "points"}
      data={{
        statuses: ctx.statuses,
        labels: ctx.labels,
        members: ctx.members,
        sprints: ctx.sprints,
        boards: ctx.boards,
        projects: ctx.projects,
        epics: ctx.epics,
        customFields: ctx.customFields,
      }}
    />
  );
}
