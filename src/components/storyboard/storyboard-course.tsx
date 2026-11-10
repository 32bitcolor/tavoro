"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, GraduationCap } from "lucide-react";

import { createCourseFromStoryboardAction, storyboardCourseAction } from "@/app/actions/storyboard-course";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// "Create course in CourseForge" on a storyboard (docs/SUITE.md, step 3). Hidden when
// the workspace has no CourseForge connected.

type State = Awaited<ReturnType<typeof storyboardCourseAction>>;

export function StoryboardCourse({ storyboardId, status, hasCard }: { storyboardId: string; status: string; hasCard: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [done, setDone] = useState<{ url: string; notes: number; card: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    storyboardCourseAction(storyboardId).then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, [storyboardId]);

  if (!state?.app) return null;
  const app = state.app;

  async function create() {
    setBusy(true);
    setError(null);
    const r = await createCourseFromStoryboardAction(storyboardId);
    setBusy(false);
    if ("error" in r) return setError({ message: r.error ?? "Couldn’t create the course.", code: "code" in r ? r.code : undefined });
    setDone({ url: r.course.url, notes: r.notes, card: !!r.card });
    setState(await storyboardCourseAction(storyboardId));
  }

  return (
    <>
      {state.course ? (
        <Button asChild variant="outline" size="sm">
          <a href={state.course.url} target="_blank" rel="noreferrer" title={`“${state.course.title}” in ${state.course.app}`}>
            <GraduationCap className="size-4" aria-hidden /> Open course
            <ExternalLink className="size-3.5 opacity-60" aria-hidden />
          </a>
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => (setOpen(true), setDone(null), setError(null))}>
          <GraduationCap className="size-4" aria-hidden /> Create course
        </Button>
      )}
      {state.course && (
        <Button type="button" variant="ghost" size="sm" onClick={() => (setOpen(true), setDone(null), setError(null))} className="text-muted-foreground">
          Create again…
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{done ? "Course created" : `Create a course in ${app.name}`}</DialogTitle>
            <DialogDescription>
              {done
                ? `A first draft is ready in ${app.name}, owned by you.`
                : `A first draft from this storyboard, owned by you in ${app.name}.`}
            </DialogDescription>
          </DialogHeader>
          {done ? (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                {done.notes > 0 && (
                  <>
                    {done.notes} build note{done.notes === 1 ? "" : "s"} are waiting in the course&rsquo;s comments.{" "}
                  </>
                )}
                {done.card && "The deliverable’s card is linked to it."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  Each screen becomes a lesson, and its <strong className="text-foreground">on-screen text</strong> becomes the lesson&rsquo;s
                  content. Knowledge checks join the screen before them.
                </li>
                <li>
                  <strong className="text-foreground">Narration, visual, interaction and developer notes</strong>, plus the project&rsquo;s assessment
                  items, become build notes: comments on each lesson, to resolve as you build. Learners never see them.
                </li>
                <li>The project&rsquo;s objectives go on the course&rsquo;s cover.</li>
                {hasCard && <li>The deliverable&rsquo;s card gets linked to the course, if it doesn&rsquo;t have one.</li>}
              </ul>
              {status !== "approved" && (
                <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  This storyboard isn&rsquo;t approved yet. Later changes here won&rsquo;t reach the course.
                </p>
              )}
              {state.course && (
                <p className="text-muted-foreground">
                  This makes a <strong className="text-foreground">new</strong> course; the one already made from this storyboard stays as it is.
                </p>
              )}
              {error && (
                <p role="alert" className="text-destructive">
                  {error.message}{" "}
                  {error.code === "no_account" && (
                    <a href={`${app.url}/auth/tavoro/start`} target="_blank" rel="noreferrer" className="font-medium underline">
                      Open {app.name}
                    </a>
                  )}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            {done ? (
              <>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button asChild>
                  <a href={done.url} target="_blank" rel="noreferrer">
                    Open in {app.name} <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={create} disabled={busy}>
                  {busy ? "Creating…" : "Create course"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
