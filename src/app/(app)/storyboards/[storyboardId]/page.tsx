import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getStoryboardForUser, whiteboardVisibilityWhere } from "@/lib/authz";
import { StoryboardView } from "@/components/storyboard/storyboard-view";

export const metadata = { title: "Storyboard · Tavoro" };

export default async function StoryboardPage({ params, searchParams }: { params: Promise<{ storyboardId: string }>; searchParams: Promise<{ screen?: string }> }) {
  const { storyboardId } = await params;
  const { screen: initialScreen } = await searchParams;

  const access = await getStoryboardForUser(storyboardId);
  if (!access) notFound();

  const storyboard = await prisma.storyboard.findUnique({
    where: { id: storyboardId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      deliverable: {
        select: { id: true, name: true, projectId: true, cardId: true, project: { select: { name: true } } },
      },
      screens: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          screenType: true,
          position: true,
          onScreenText: true,
          narration: true,
          visualNotes: true,
          interactionNotes: true,
          developerNotes: true,
          objectives: { select: { objectiveId: true } },
        },
      },
    },
  });
  if (!storyboard) notFound();

  const whiteboards = await prisma.whiteboard.findMany({
    where: { storyboardId, ...(await whiteboardVisibilityWhere()) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true },
  });

  // The project's objectives (via the linked deliverable) — screens tag which they teach.
  const projectId = storyboard.deliverable?.projectId;
  const projectObjectives = projectId
    ? await prisma.learningObjective.findMany({
        where: { projectId },
        orderBy: { position: "asc" },
        select: { id: true, text: true },
      })
    : [];

  const screens = storyboard.screens.map((s) => ({
    id: s.id,
    title: s.title,
    screenType: s.screenType,
    position: s.position,
    onScreenText: s.onScreenText,
    narration: s.narration,
    visualNotes: s.visualNotes,
    interactionNotes: s.interactionNotes,
    developerNotes: s.developerNotes,
    objectiveIds: s.objectives.map((o) => o.objectiveId),
  }));

  return (
    <StoryboardView
      initialScreen={typeof initialScreen === "string" ? initialScreen : undefined}
      whiteboards={whiteboards}
      storyboard={{
        id: storyboard.id,
        title: storyboard.title,
        description: storyboard.description,
        status: storyboard.status,
        deliverable: storyboard.deliverable
          ? {
              id: storyboard.deliverable.id,
              name: storyboard.deliverable.name,
              projectId: storyboard.deliverable.projectId,
              projectName: storyboard.deliverable.project.name,
              cardId: storyboard.deliverable.cardId,
            }
          : null,
      }}
      initialScreens={screens}
      projectObjectives={projectObjectives}
    />
  );
}
