// CourseForge, as Tavoro sees it (docs/SUITE.md, step 2): find, create and summarise
// courses through the connected app's suite API (/api/suite/courses), authenticated
// with the connection's client id and secret. Relative imports and no "server-only":
// the worker refreshes linked cards with it.
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { open } from "./secret-box";

export type CourseState = "draft" | "review" | "live";

export interface CourseSummary {
  id: string;
  title: string;
  url: string;
  cover: string | null;
  lessons: number;
  micro: boolean;
  state: CourseState;
  openComments: number;
  checks: { errors: number; warnings: number };
  owner: string;
  updatedAt: string;
  deleted: boolean;
}

export interface AppRef {
  id: string;
  url: string;
  clientId: string;
  secretSealed: string;
}

export class CourseForgeError extends Error {
  constructor(
    message: string,
    readonly code: "no_account" | "forbidden" | "unreachable" | "rejected" | "error" = "error",
  ) {
    super(message);
  }
}

/** Refresh summaries this often (board badges); opening a card refreshes at once. */
export const STALE_MS = 10 * 60 * 1000;

async function call<T>(app: AppRef, path: string, init: RequestInit = {}): Promise<T> {
  const auth = `Basic ${Buffer.from(`${encodeURIComponent(app.clientId)}:${encodeURIComponent(open(app.secretSealed))}`).toString("base64")}`;
  let res: Response;
  try {
    res = await fetch(`${app.url}${path}`, {
      ...init,
      headers: { authorization: auth, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
  } catch {
    throw new CourseForgeError("CourseForge didn’t answer. Try again in a moment.", "unreachable");
  }
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (res.status === 401) throw new CourseForgeError("CourseForge didn’t accept Tavoro’s key. An admin needs to paste the current key into CourseForge (Settings → Connected apps → New key).", "rejected");
  if (!res.ok) throw new CourseForgeError(j.message ?? `CourseForge answered ${res.status}.`, (j.error as CourseForgeError["code"]) ?? "error");
  return j;
}

/** Courses this person can edit in CourseForge, newest first (the link picker). */
export async function searchCourses(app: AppRef, sub: string, q: string) {
  const r = await call<{ courses: CourseSummary[] }>(app, `/api/suite/courses?sub=${encodeURIComponent(sub)}&q=${encodeURIComponent(q.slice(0, 100))}`);
  return r.courses;
}

export interface StoryboardPayload {
  title: string;
  description?: string | null;
  objectives?: string[];
  screens: { id: string; title: string; type: string; onScreenText?: string | null; narration?: string | null; visualNotes?: string | null; interactionNotes?: string | null; developerNotes?: string | null; objectives?: string[] }[];
  assessmentItems?: { prompt: string; type: string; objectives?: string[] }[];
  source?: { url?: string; project?: string };
}

/** A first-draft course from a storyboard (docs/SUITE.md, step 3), owned by this person. */
export async function courseFromStoryboard(app: AppRef, sub: string, storyboard: StoryboardPayload) {
  return call<{ course: CourseSummary; notes: number }>(app, "/api/suite/storyboards", { method: "POST", body: JSON.stringify({ sub, storyboard }) });
}

/** A new blank course owned by this person in CourseForge. */
export async function createCourse(app: AppRef, sub: string, title: string) {
  const r = await call<{ course: CourseSummary }>(app, "/api/suite/courses", { method: "POST", body: JSON.stringify({ sub, title }) });
  return r.course;
}

/** Summaries of these courses; with `sub`, only those that person can edit. */
export async function summaries(app: AppRef, ids: string[], sub?: string) {
  if (!ids.length) return [];
  const r = await call<{ courses: CourseSummary[] }>(app, `/api/suite/courses?ids=${ids.map(encodeURIComponent).join(",")}${sub ? `&sub=${encodeURIComponent(sub)}` : ""}`);
  return r.courses;
}

type Db = PrismaClient | Prisma.TransactionClient;

/** Refresh the cached summaries of linked cards: these card links, or every stale one. */
export async function refreshCardCourses(db: Db, opts: { ids?: string[]; staleOnly?: boolean } = {}) {
  const rows = await db.cardCourse.findMany({
    where: { ...(opts.ids ? { id: { in: opts.ids } } : {}), ...(opts.staleOnly ? { syncedAt: { lt: new Date(Date.now() - STALE_MS) } } : {}) },
    select: { id: true, courseId: true, app: { select: { id: true, url: true, clientId: true, secretSealed: true } } },
    take: 2000,
  });
  const byApp = new Map<string, { app: AppRef; rows: typeof rows }>();
  for (const r of rows) {
    const g = byApp.get(r.app.id) ?? { app: r.app, rows: [] };
    g.rows.push(r);
    byApp.set(r.app.id, g);
  }
  let updated = 0;
  for (const { app, rows: group } of byApp.values()) {
    for (let i = 0; i < group.length; i += 100) {
      const chunk = group.slice(i, i + 100);
      let found: CourseSummary[];
      try {
        found = await summaries(app, [...new Set(chunk.map((r) => r.courseId))]);
      } catch {
        continue; // unreachable or rejected: keep the old summaries
      }
      const byId = new Map(found.map((s) => [s.id, s]));
      for (const r of chunk) {
        const s = byId.get(r.courseId);
        await db.cardCourse.update({
          where: { id: r.id },
          data: s ? { title: s.title, summary: s as unknown as Prisma.InputJsonValue, missing: s.deleted, syncedAt: new Date() } : { missing: true, syncedAt: new Date() },
        });
        updated++;
      }
    }
  }
  return updated;
}
