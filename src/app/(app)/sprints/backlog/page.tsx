import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { loadBacklog } from "@/lib/backlog";
import { listEpics } from "@/lib/epics";
import { BacklogView } from "@/components/sprint/backlog-view";

export const metadata = { title: "Backlog · Tavoro" };

export default async function BacklogPage() {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const wsId = membership.workspaceId;

  const [backlog, statuses, workspace, epics] = await Promise.all([
    loadBacklog(wsId),
    prisma.workspaceStatus.findMany({ where: { workspaceId: wsId }, orderBy: { position: "asc" }, select: { id: true, name: true, category: true } }),
    prisma.workspace.findUnique({ where: { id: wsId }, select: { estimateUnit: true } }),
    listEpics(),
  ]);

  return (
    <BacklogView
      sprints={backlog.sprints}
      initialCards={backlog.cards}
      hiddenBacklog={backlog.hiddenBacklog}
      statuses={statuses.map((s) => ({ ...s, category: s.category as "todo" | "active" | "done" }))}
      epics={epics.map((e) => ({ id: e.id, title: e.title, key: e.key, progress: e.progress }))}
      estimateUnit={workspace?.estimateUnit === "hours" ? "hours" : "points"}
    />
  );
}
