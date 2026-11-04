import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getProjectForUser, boardVisibilityWhere } from "@/lib/authz";
import { ProjectView } from "@/components/project/project-view";
import { loadProjectContext } from "@/lib/project-context";

export const metadata = { title: "Project · Tavoro" };

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const access = await getProjectForUser(projectId);
  if (!access) notFound();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      methodology: true,
      status: true,
      sprintsEnabled: true,
      intakeRequest: { select: { id: true, number: true } },
      boards: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, _count: { select: { columns: true } } },
      },
      phases: {
        orderBy: { position: "asc" },
        select: { id: true, name: true, status: true, position: true, startDate: true, endDate: true },
      },
      deliverables: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          phaseId: true,
          cardId: true,
          card: {
            select: { id: true, title: true, column: { select: { board: { select: { id: true, name: true } } } } },
          },
          storyboard: { select: { id: true, title: true } },
          contentItems: { select: { id: true }, take: 1 },
          reviewRounds: {
            orderBy: { number: "desc" },
            select: {
              id: true,
              number: true,
              outcome: true,
              overriddenAt: true,
              dueDate: true,
              targetKind: true,
              file: { select: { id: true, fileName: true, mimeType: true } },
              assignments: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  status: true,
                  reviewer: { select: { id: true, name: true, email: true } },
                  guest: { select: { name: true, email: true } },
                },
              },
              _count: { select: { comments: { where: { parentId: null, status: "open" } } } },
            },
          },
        },
      },
      objectives: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          text: true,
          bloomLevel: true,
          position: true,
          _count: { select: { screens: true } },
        },
      },
      assessmentItems: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          prompt: true,
          itemType: true,
          position: true,
          objectives: { select: { objectiveId: true } },
        },
      },
      milestones: {
        orderBy: { position: "asc" },
        select: { id: true, name: true, dueDate: true, completedAt: true },
      },
      timeEntries: {
        orderBy: { loggedFor: "desc" },
        select: {
          id: true,
          minutes: true,
          note: true,
          loggedFor: true,
          user: { select: { id: true, name: true, email: true } },
          deliverable: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!project) notFound();

  const members = await prisma.user.findMany({
    where: { memberships: { some: { workspaceId: access.workspaceId, suspendedAt: null } } },
    orderBy: { email: "asc" },
    select: { id: true, name: true, email: true },
  });

  // Coverage: screens across this project's storyboards, and how many teach nothing.
  const projScreens = await prisma.screen.findMany({
    where: { storyboard: { deliverable: { projectId } } },
    select: { objectives: { select: { objectiveId: true }, take: 1 } },
  });
  const coverage = {
    totalScreens: projScreens.length,
    orphanScreens: projScreens.filter((s) => s.objectives.length === 0).length,
  };

  const objectives = project.objectives.map((o) => ({
    id: o.id,
    text: o.text,
    bloomLevel: o.bloomLevel,
    position: o.position,
    screenCount: o._count.screens,
  }));

  const assessments = project.assessmentItems.map((a) => ({
    id: a.id,
    prompt: a.prompt,
    itemType: a.itemType,
    position: a.position,
    objectiveIds: a.objectives.map((x) => x.objectiveId),
  }));

  const phases = project.phases.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    position: p.position,
    startDate: p.startDate ? p.startDate.toISOString() : null,
    endDate: p.endDate ? p.endDate.toISOString() : null,
  }));

  const deliverables = project.deliverables.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    status: d.status,
    phaseId: d.phaseId,
    card: d.card?.column
      ? { id: d.card.id, title: d.card.title, boardId: d.card.column.board.id, boardName: d.card.column.board.name }
      : null,
    storyboard: d.storyboard ? { id: d.storyboard.id, title: d.storyboard.title } : null,
    contentItemId: d.contentItems[0]?.id ?? null,
    rounds: d.reviewRounds.map((r) => ({
      id: r.id,
      number: r.number,
      outcome: r.outcome,
      overridden: !!r.overriddenAt,
      dueDate: r.dueDate ? r.dueDate.toISOString() : null,
      openComments: r._count.comments,
      hasSnapshot: r.targetKind === "storyboard",
      file: r.file,
      reviewers: r.assignments.map((a) => ({
        id: a.reviewer?.id ?? a.id,
        name: a.reviewer ? a.reviewer.name ?? a.reviewer.email : a.guest?.name ?? "Guest",
        status: a.status,
        guest: a.guest ? { name: a.guest.name, email: a.guest.email } : null,
      })),
    })),
  }));

  const milestones = project.milestones.map((m) => ({
    id: m.id,
    name: m.name,
    dueDate: m.dueDate ? m.dueDate.toISOString() : null,
    completedAt: m.completedAt ? m.completedAt.toISOString() : null,
  }));

  const timeEntries = project.timeEntries.map((t) => ({
    id: t.id,
    minutes: t.minutes,
    note: t.note,
    loggedFor: t.loggedFor.toISOString(),
    user: t.user,
    deliverable: t.deliverable,
  }));

  // Standalone (project-less) boards the user can see — offered as "add existing".
  const unassignedBoards = await prisma.board.findMany({
    where: { workspaceId: access.workspaceId, projectId: null, ...(await boardVisibilityWhere()) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, _count: { select: { columns: true } } },
  });

  return (
    <ProjectView
      context={await loadProjectContext(project.id)}
      project={{
        id: project.id,
        name: project.name,
        description: project.description,
        methodology: project.methodology,
        status: project.status,
        sprintsEnabled: project.sprintsEnabled,
        fromRequest: project.intakeRequest,
      }}
      initialBoards={project.boards.map((b) => ({ id: b.id, name: b.name, columnCount: b._count.columns }))}
      availableBoards={unassignedBoards.map((b) => ({ id: b.id, name: b.name, columnCount: b._count.columns }))}
      initialPhases={phases}
      initialObjectives={objectives}
      initialAssessments={assessments}
      coverage={coverage}
      initialDeliverables={deliverables}
      initialMilestones={milestones}
      initialTimeEntries={timeEntries}
      members={members}
    />
  );
}
