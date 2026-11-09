import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getCardForUser } from "@/lib/authz";
import { recordActivity } from "@/lib/card-activity";
import { CourseForgeError, createCourse, refreshCardCourses, searchCourses, summaries, type CourseSummary } from "@/lib/courseforge";

// A card's CourseForge course (docs/SUITE.md, step 2). The UI's server actions and the
// MCP tools both go through here; access is the card's (anyone who can see the card can
// link or unlink), and CourseForge applies the person's own access to what they can
// find or create there.

const APP_SELECT = { id: true, name: true, url: true, clientId: true, secretSealed: true } as const;

export interface LinkedCourse {
  courseId: string;
  title: string;
  summary: CourseSummary | null;
  missing: boolean;
  syncedAt: string;
  app: { name: string; url: string };
}

export type Result<T> = T | { error: string; code?: string };

async function cardContext(cardId: string) {
  const access = await getCardForUser(cardId);
  if (!access) return null;
  const board = await prisma.board.findUnique({ where: { id: access.boardId }, select: { workspaceId: true } });
  if (!board) return null;
  const app = await prisma.connectedApp.findFirst({ where: { workspaceId: board.workspaceId, kind: "courseforge" }, orderBy: { createdAt: "asc" }, select: APP_SELECT });
  return { ...access, workspaceId: board.workspaceId, app };
}

function shape(row: { courseId: string; title: string; summary: Prisma.JsonValue; missing: boolean; syncedAt: Date; app: { name: string; url: string } }): LinkedCourse {
  const s = row.summary as unknown as CourseSummary | null;
  return { courseId: row.courseId, title: row.title, summary: s && s.id ? s : null, missing: row.missing, syncedAt: row.syncedAt.toISOString(), app: { name: row.app.name, url: row.app.url } };
}

const linkedRow = (cardId: string) =>
  prisma.cardCourse.findUnique({ where: { cardId }, select: { id: true, courseId: true, title: true, summary: true, missing: true, syncedAt: true, app: { select: { name: true, url: true } } } });

const fail = (e: unknown) => (e instanceof CourseForgeError ? { error: e.message, code: e.code } : { error: "Something went wrong talking to CourseForge." });

/** The card's course (refreshed from CourseForge when `refresh`), and whether one can be linked. */
export async function getCardCourse(cardId: string, refresh = false): Promise<Result<{ course: LinkedCourse | null; app: { name: string; url: string } | null }>> {
  const ctx = await cardContext(cardId);
  if (!ctx) return { error: "Card not found." };
  let row = await linkedRow(cardId);
  if (row && refresh) {
    await refreshCardCourses(prisma, { ids: [row.id] });
    row = await linkedRow(cardId);
  }
  return { course: row ? shape(row) : null, app: ctx.app ? { name: ctx.app.name, url: ctx.app.url } : null };
}

/** Courses the caller can edit in CourseForge, for the link picker. */
export async function findCourses(cardId: string, userId: string, q: string): Promise<Result<{ courses: CourseSummary[] }>> {
  const ctx = await cardContext(cardId);
  if (!ctx) return { error: "Card not found." };
  if (!ctx.app) return { error: "CourseForge isn’t connected to this workspace. An admin can connect it in Settings → Connected apps.", code: "not_connected" };
  try {
    return { courses: await searchCourses(ctx.app, userId, q) };
  } catch (e) {
    return fail(e);
  }
}

async function attach(ctx: NonNullable<Awaited<ReturnType<typeof cardContext>>>, cardId: string, userId: string, s: CourseSummary) {
  const before = await prisma.cardCourse.findUnique({ where: { cardId }, select: { title: true } });
  const data = { appId: ctx.app!.id, courseId: s.id, title: s.title, summary: s as unknown as Prisma.InputJsonValue, missing: s.deleted, syncedAt: new Date(), linkedById: userId };
  await prisma.cardCourse.upsert({ where: { cardId }, create: { cardId, ...data }, update: data });
  await recordActivity(cardId, userId, "course", { from: before?.title ?? null, to: s.title });
  const row = await linkedRow(cardId);
  return { course: shape(row!) };
}

/** Link a course the caller can edit in CourseForge (replacing any course already linked). */
export async function linkCourse(cardId: string, userId: string, courseId: string): Promise<Result<{ course: LinkedCourse }>> {
  const ctx = await cardContext(cardId);
  if (!ctx) return { error: "Card not found." };
  if (!ctx.app) return { error: "CourseForge isn’t connected to this workspace.", code: "not_connected" };
  try {
    // Only a course this person can edit in CourseForge: an id alone isn't permission.
    const [s] = await summaries(ctx.app, [courseId], userId);
    if (!s) return { error: "You can’t edit that course in CourseForge (or it doesn’t exist). Ask its owner to share it with you." };
    return await attach(ctx, cardId, userId, s);
  } catch (e) {
    return fail(e);
  }
}

/** Start a new course in CourseForge, named after the card, and link it. */
export async function createCourseForCard(cardId: string, userId: string, title?: string): Promise<Result<{ course: LinkedCourse }>> {
  const ctx = await cardContext(cardId);
  if (!ctx) return { error: "Card not found." };
  if (!ctx.app) return { error: "CourseForge isn’t connected to this workspace.", code: "not_connected" };
  const card = await prisma.card.findUnique({ where: { id: cardId }, select: { title: true } });
  const name = (title?.trim() || card?.title || "Untitled course").replace(/^course:\s*/i, "").slice(0, 200);
  try {
    return await attach(ctx, cardId, userId, await createCourse(ctx.app, userId, name));
  } catch (e) {
    return fail(e);
  }
}

export async function unlinkCourse(cardId: string, userId: string): Promise<Result<{ ok: true }>> {
  const ctx = await cardContext(cardId);
  if (!ctx) return { error: "Card not found." };
  const row = await prisma.cardCourse.findUnique({ where: { cardId }, select: { id: true, title: true } });
  if (!row) return { ok: true };
  await prisma.cardCourse.delete({ where: { id: row.id } });
  await recordActivity(cardId, userId, "course", { from: row.title, to: null });
  return { ok: true };
}

/** Short status line for a course, as cards and MCP describe it. */
export function courseLine(s: CourseSummary | null, missing: boolean): string {
  if (missing) return "deleted in CourseForge";
  if (!s) return "not synced yet";
  const parts = [s.state === "live" ? "live in an LMS" : s.state === "review" ? "in review" : "draft", `${s.lessons} lesson${s.lessons === 1 ? "" : "s"}`];
  if (s.openComments) parts.push(`${s.openComments} open comment${s.openComments === 1 ? "" : "s"}`);
  if (s.checks.errors) parts.push(`${s.checks.errors} problem${s.checks.errors === 1 ? "" : "s"} to fix`);
  return parts.join(" · ");
}
