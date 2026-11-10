import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getStoryboardForUser } from "@/lib/authz";
import { appUrl } from "@/lib/app-url";
import { recordActivity } from "@/lib/card-activity";
import { toMarkdown } from "@/lib/markdown";
import { CourseForgeError, courseFromStoryboard, type CourseSummary } from "@/lib/courseforge";

// Storyboard → CourseForge course draft (docs/SUITE.md, step 3). Tavoro sends the
// storyboard as Markdown; CourseForge decides what becomes blocks and what becomes
// build notes. The new course is linked to the storyboard and, when the storyboard's
// deliverable has a card without a course, to that card too.

const md = (doc: string | null | undefined) => {
  const s = toMarkdown(doc).trim();
  return s || null;
};

export async function storyboardCourseState(storyboardId: string) {
  const access = await getStoryboardForUser(storyboardId);
  if (!access) return null;
  const [sb, app] = await Promise.all([
    prisma.storyboard.findUnique({ where: { id: storyboardId }, select: { courseId: true, courseTitle: true, courseAt: true, courseApp: { select: { name: true, url: true } } } }),
    prisma.connectedApp.findFirst({ where: { workspaceId: access.workspaceId, kind: "courseforge" }, orderBy: { createdAt: "asc" }, select: { name: true, url: true } }),
  ]);
  return {
    app,
    course: sb?.courseId && sb.courseApp ? { id: sb.courseId, title: sb.courseTitle ?? "Course", at: sb.courseAt?.toISOString() ?? null, url: `${sb.courseApp.url}/courses/${sb.courseId}`, app: sb.courseApp.name } : null,
  };
}

export async function createCourseFromStoryboard(
  storyboardId: string,
  userId: string,
): Promise<{ error: string; code?: string } | { course: CourseSummary; notes: number; card: string | null }> {
  const access = await getStoryboardForUser(storyboardId);
  if (!access) return { error: "Storyboard not found." };
  const app = await prisma.connectedApp.findFirst({ where: { workspaceId: access.workspaceId, kind: "courseforge" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, url: true, clientId: true, secretSealed: true } });
  if (!app) return { error: "CourseForge isn’t connected to this workspace. An admin can connect it in Settings → Connected apps.", code: "not_connected" };

  const sb = await prisma.storyboard.findUniqueOrThrow({
    where: { id: storyboardId },
    select: {
      title: true,
      description: true,
      deliverable: { select: { id: true, cardId: true, projectId: true, project: { select: { name: true } } } },
      screens: {
        orderBy: { position: "asc" },
        select: { id: true, title: true, screenType: true, onScreenText: true, narration: true, visualNotes: true, interactionNotes: true, developerNotes: true, objectives: { select: { objective: { select: { text: true } } } } },
      },
    },
  });
  if (!sb.screens.length) return { error: "This storyboard has no screens yet." };
  const projectId = sb.deliverable?.projectId;
  const [objectives, items] = projectId
    ? await Promise.all([
        prisma.learningObjective.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { text: true } }),
        prisma.assessmentItem.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { prompt: true, itemType: true, objectives: { select: { objective: { select: { text: true } } } } } }),
      ])
    : [[], []];

  let result: Awaited<ReturnType<typeof courseFromStoryboard>>;
  try {
    result = await courseFromStoryboard(app, userId, {
      title: sb.title,
      description: md(sb.description) ?? sb.description,
      objectives: objectives.map((o) => o.text),
      screens: sb.screens.map((s) => ({
        id: s.id,
        title: s.title,
        type: s.screenType,
        onScreenText: md(s.onScreenText),
        narration: md(s.narration),
        visualNotes: md(s.visualNotes),
        interactionNotes: md(s.interactionNotes),
        developerNotes: md(s.developerNotes),
        objectives: s.objectives.map((o) => o.objective.text),
      })),
      assessmentItems: items.map((a) => ({ prompt: a.prompt, type: a.itemType, objectives: a.objectives.map((o) => o.objective.text) })),
      source: { url: appUrl(`/storyboards/${storyboardId}`), project: sb.deliverable?.project.name },
    });
  } catch (e) {
    return e instanceof CourseForgeError ? { error: e.message, code: e.code } : { error: "Something went wrong talking to CourseForge." };
  }
  const c = result.course;
  await prisma.storyboard.update({ where: { id: storyboardId }, data: { courseAppId: app.id, courseId: c.id, courseTitle: c.title, courseAt: new Date() } });

  // The deliverable's card gets the course too, unless it already has one.
  let card: string | null = null;
  const cardId = sb.deliverable?.cardId;
  if (cardId && !(await prisma.cardCourse.findUnique({ where: { cardId }, select: { id: true } }))) {
    await prisma.cardCourse.create({ data: { cardId, appId: app.id, courseId: c.id, title: c.title, summary: c as unknown as Prisma.InputJsonValue, linkedById: userId } });
    await recordActivity(cardId, userId, "course", { from: null, to: c.title });
    card = cardId;
  }
  return { course: c, notes: result.notes, card };
}
