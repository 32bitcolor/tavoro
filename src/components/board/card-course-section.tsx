"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, GraduationCap, Link2, MessageSquare, Plus, RefreshCw, Search, Unlink } from "lucide-react";

import { createCourseForCardAction, findCoursesAction, getCardCourseAction, linkCourseAction, unlinkCourseAction } from "@/app/actions/card-course";
import type { CourseSummary } from "@/lib/courseforge";
import type { LinkedCourse } from "@/lib/card-courses";
import { cn } from "@/lib/utils";

// "Course" in the card drawer (docs/SUITE.md, step 2): the card's CourseForge course,
// with its live status, or a picker to link or start one. Hidden when the workspace
// has no CourseForge connected.

const STATE: Record<CourseSummary["state"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
  review: { label: "In review", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  live: { label: "Live in LMS", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function StatePill({ state, className }: { state: CourseSummary["state"]; className?: string }) {
  const s = STATE[state];
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", s.cls, className)}>{s.label}</span>;
}

function Cover({ src, className }: { src: string | null; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- another app's image, not ours to optimise
    <img src={src} alt="" className={cn("shrink-0 rounded object-cover", className)} />
  ) : (
    <span className={cn("flex shrink-0 items-center justify-center rounded bg-muted text-muted-foreground", className)}>
      <GraduationCap className="size-4" aria-hidden />
    </span>
  );
}

type Loaded = { course: LinkedCourse | null; app: { name: string; url: string } | null };

export function CardCourseSection({ cardId, onLinkedChange }: { cardId: string; onLinkedChange?: (course: { title: string; state: CourseSummary["state"] | null } | null) => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CourseSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);

  function apply(r: Awaited<ReturnType<typeof getCardCourseAction>>) {
    if ("error" in r) return;
    setData(r);
    onLinkedChange?.(r.course ? { title: r.course.title, state: r.course.summary?.state ?? null } : null);
  }

  useEffect(() => {
    let live = true;
    // Show what we have, then refresh from CourseForge.
    getCardCourseAction(cardId).then((r) => {
      if (!live || "error" in r) return;
      setData(r);
      if (r.course) getCardCourseAction(cardId, true).then((x) => live && apply(x));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per card
  }, [cardId]);

  useEffect(() => {
    if (!picking) return;
    let live = true;
    const t = setTimeout(() => {
      findCoursesAction(cardId, query).then((r) => {
        if (!live) return;
        if ("error" in r) {
          setError({ message: r.error ?? "Couldn’t reach CourseForge.", code: "code" in r ? r.code : undefined });
          setResults([]);
        } else {
          setError(null);
          setResults(r.courses);
        }
      });
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [picking, query, cardId]);

  async function run(fn: () => Promise<{ error?: string; code?: string } | object>) {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if ("error" in r && r.error) {
      setError({ message: r.error, code: "code" in r ? r.code : undefined });
      return false;
    }
    apply(await getCardCourseAction(cardId));
    setPicking(false);
    setQuery("");
    return true;
  }

  if (!data?.app) return null;
  const { course, app } = data;
  const s = course?.summary ?? null;

  const errorBox = error && (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        {error.message}{" "}
        {error.code === "no_account" && (
          <a href={`${app.url}/auth/tavoro/start`} target="_blank" rel="noreferrer" className="font-medium underline">
            Open {app.name}
          </a>
        )}
      </span>
    </p>
  );

  return (
    <section aria-labelledby={`course-${cardId}`}>
      <h3 id={`course-${cardId}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Course
      </h3>

      {course ? (
        <div className="flex flex-col gap-2">
          <div className={cn("flex gap-3 rounded-md border border-border p-2.5", course.missing && "opacity-70")}>
            <Cover src={s?.cover ?? null} className="h-14 w-20" />
            <div className="min-w-0 flex-1">
              <a href={s?.url ?? `${app.url}/courses/${course.courseId}`} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 font-medium hover:underline">
                <span className="truncate">{course.title}</span>
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="sr-only">(opens {app.name})</span>
              </a>
              {course.missing ? (
                <p className="mt-1 text-xs text-destructive">This course was deleted in {app.name}.</p>
              ) : s ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <StatePill state={s.state} />
                  <span>
                    {s.micro ? "Microlearning" : `${s.lessons} lesson${s.lessons === 1 ? "" : "s"}`}
                  </span>
                  {s.openComments > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="size-3" aria-hidden /> {s.openComments} open comment{s.openComments === 1 ? "" : "s"}
                    </span>
                  )}
                  {s.checks.errors > 0 ? (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <AlertTriangle className="size-3" aria-hidden /> {s.checks.errors} problem{s.checks.errors === 1 ? "" : "s"} to fix
                    </span>
                  ) : s.checks.warnings > 0 ? (
                    <span>{s.checks.warnings} warning{s.checks.warnings === 1 ? "" : "s"}</span>
                  ) : (
                    <span>Checks pass</span>
                  )}
                  <span suppressHydrationWarning>
                    Edited {ago(s.updatedAt)} · {s.owner}
                  </span>
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Not synced yet.</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <button type="button" disabled={busy} onClick={() => setPicking((p) => !p)} className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground">
              <Link2 className="size-3.5" aria-hidden /> Change
            </button>
            <button type="button" disabled={busy} onClick={() => run(() => unlinkCourseAction(cardId))} className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground">
              <Unlink className="size-3.5" aria-hidden /> Unlink
            </button>
            <button type="button" disabled={busy} onClick={async () => { setBusy(true); apply(await getCardCourseAction(cardId, true)); setBusy(false); }} className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" title="Refresh from CourseForge">
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} aria-hidden />
              <span suppressHydrationWarning>Synced {ago(course.syncedAt)}</span>
            </button>
          </div>
        </div>
      ) : (
        !picking && (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => setPicking(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm hover:bg-hover">
              <Link2 className="size-4" aria-hidden /> Link a course
            </button>
            <button type="button" disabled={busy} onClick={() => run(() => createCourseForCardAction(cardId))} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm hover:bg-hover">
              <Plus className="size-4" aria-hidden /> {busy ? "Creating…" : `New course in ${app.name}`}
            </button>
          </div>
        )
      )}

      {picking && (
        <div className="mt-2 flex flex-col gap-1.5">
          <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="sr-only">Find a course in {app.name}</span>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setPicking(false);
                }
              }}
              placeholder={`Search your ${app.name} courses`}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <ul className="flex max-h-64 flex-col overflow-y-auto rounded-md border border-border" aria-label={`Courses in ${app.name}`}>
            {results === null ? (
              <li className="px-2.5 py-2 text-xs text-muted-foreground">Loading…</li>
            ) : results.length === 0 ? (
              <li className="px-2.5 py-2 text-xs text-muted-foreground">{error ? "—" : "No courses you can edit match."}</li>
            ) : (
              results.map((r) => (
                <li key={r.id}>
                  <button type="button" disabled={busy || r.id === course?.courseId} onClick={() => run(() => linkCourseAction(cardId, r.id))} className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-sm hover:bg-hover disabled:opacity-60">
                    <Cover src={r.cover} className="h-8 w-12" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{r.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {r.micro ? "Microlearning" : `${r.lessons} lesson${r.lessons === 1 ? "" : "s"}`} · {r.owner}
                      </span>
                    </span>
                    <StatePill state={r.state} />
                    <span className="sr-only">Link this course</span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <button type="button" onClick={() => setPicking(false)} className="self-start text-xs font-medium text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      )}
      {errorBox && <div className="mt-2">{errorBox}</div>}
    </section>
  );
}
