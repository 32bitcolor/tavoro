import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { loadRoadmap } from "@/lib/roadmap";
import { RoadmapView } from "@/components/sprint/roadmap-view";

export const metadata = { title: "Roadmap · Tavoro" };

export default async function RoadmapPage() {
  const m = await getActiveMembership();
  if (!m) redirect("/login");
  const [epics, statuses] = await Promise.all([
    loadRoadmap(m.workspaceId),
    prisma.workspaceStatus.findMany({ where: { workspaceId: m.workspaceId }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  // Remount when the data changes (e.g. after editing an epic in the card panel).
  const key = epics.map((e) => `${e.id}:${e.startDate}:${e.dueDate}:${e.done}:${e.progress.done}/${e.progress.total}:${e.title.length}`).join("|");
  return <RoadmapView key={key} initial={epics} today={today} statuses={statuses} />;
}
