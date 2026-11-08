"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Check,
  CheckCheck,
  CircleSlash,
  ListChecks,
  MessageSquare,
  MessageSquarePlus,
  Quote,
  RotateCcw,
  ShieldCheck,
  SquareKanban,
  Trash2,
  Undo2,
} from "lucide-react";

import {
  addReviewComment,
  deleteReviewComment,
  overrideReviewRound,
  setReviewCommentStatus,
  setReviewFeedback,
  setReviewStatus,
} from "@/app/actions/reviews";
import type { ReviewCommentDTO } from "@/lib/review-comments";
import { FileReview, pageDomId, pinDomId, type FilePin, type ReviewFileView } from "@/components/review/file-review";
import { VideoReview, type VideoPin } from "@/components/review/video-review";
import { guestAddComment, guestDecide, guestDeleteComment, guestReopen } from "@/app/actions/review-guest";
import { ReviewerList, type Assignment } from "@/components/review/reviewer-list";
import { CardChip, SendToBoardDialog } from "@/components/review/send-to-board";
import type { LinkedComment } from "@/app/actions/review-feedback";
import { ExportMenu } from "@/components/shared/export-menu";
import { useSetPageTitle } from "@/components/app-shell/breadcrumbs";
import { CommentBody, CommentComposer } from "@/components/board/comment-editor";
import type { MentionMember } from "@/components/board/mention-list";
import { roundLabel, roundTone } from "@/components/project/review-rounds";
import { StatusBadge } from "@/components/shared/status-badge";
import { DueChip } from "@/components/shared/work-item";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  GENERAL_ANCHOR,
  isFileAnchor,
  isVideoAnchor,
  timecode,
  SCREEN_FIELDS,
  SCREEN_FIELD_LABEL,
  parseAnchor,
  type ReviewAnchor,
  type ScreenField,
} from "@/lib/review-anchor";
import type { ScreenChange, SnapshotDiff, StoryboardSnapshot } from "@/lib/review-snapshot";
import { isApproval, isDecided, type ReviewDecision } from "@/lib/methodology";
import { extractText } from "@/lib/mentions";
import { cn } from "@/lib/utils";
import { LocalTime } from "@/components/shared/local-time";

/** Who's looking: a workspace member in the app, or a guest on their review link. */
export type Viewer =
  | { kind: "member"; id: string; canModerate: boolean }
  | {
      kind: "guest";
      id: string; // the guest id
      name: string;
      canComment: boolean;
      canDecide: boolean;
      superseded: boolean;
      closed: boolean;
      expiresAt: string;
    };

type RoundInfo = {
  id: string;
  number: number;
  dueDate: string | null;
  outcome: string | null;
  overridden: { by: string; at: string; reason: string } | null;
  requestedBy: string | null;
  hasStoryboardNow: boolean;
  /** Set when the round reviews an uploaded PDF or image. */
  file: ReviewFileView | null;
  /** The previous round's file, to say whether this is a new version. */
  previousFile: { number: number; fileName: string; same: boolean } | null;
};

const SCREEN_TYPE_LABEL: Record<string, string> = {
  intro: "Intro",
  content: "Content",
  video: "Video",
  knowledge_check: "Knowledge check",
  interaction: "Interaction",
  assessment: "Assessment",
  summary: "Summary",
};

function when(iso: string) {
  return <LocalTime iso={iso} format="dateTime" />;
}

/** A timestamp in the viewer's own timezone. The server renders it in ITS timezone,
 *  so the text legitimately differs on hydration — hence the suppression. */
function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {when(iso)}
    </time>
  );
}

const fieldDomId = (screenId: string, field: ScreenField) => `field-${screenId}-${field}`;
const anchorKey = (a: ReviewAnchor) => (a.kind === "storyboard_field" ? `${a.screenId}:${a.field}` : "general");

/** The text a comment quotes: selected in a storyboard field, or in a PDF's text. */
function quoteOf(a: ReviewAnchor): string | undefined {
  return a.kind === "storyboard_field" || a.kind === "file_region" ? a.quote?.exact : undefined;
}

/** Whether a stored field has any words in it (empty fields aren't shown). */
function hasText(doc: string | null): boolean {
  return extractText(doc) !== "";
}

export function ReviewRoundView({
  viewer,
  members,
  round,
  deliverable,
  project,
  assignments,
  snapshot,
  previousNumber,
  diff,
  initialComments,
  focusThread = null,
}: {
  viewer: Viewer;
  /** For @-mentions. Empty for guests: the picker would hand them the member list. */
  members: MentionMember[];
  round: RoundInfo;
  deliverable: { id: string; name: string };
  project: { id: string; name: string };
  assignments: Assignment[];
  snapshot: StoryboardSnapshot | null;
  previousNumber: number | null;
  diff: SnapshotDiff | null;
  initialComments: ReviewCommentDTO[];
  /** A thread to scroll to on load (?thread=<id>, from the feedback page or a card). */
  focusThread?: string | null;
}) {
  const guest = viewer.kind === "guest";
  useSetPageTitle(`${deliverable.name} · Round ${round.number}`, [
    { label: "Projects", href: "/projects" },
    { label: project.name, href: `/projects/${project.id}` },
  ]);
  const me = { id: viewer.id };
  const canOverride = viewer.kind === "member" && viewer.canModerate;
  const canComment = viewer.kind === "member" || viewer.canComment;
  const mentionMembers = guest ? undefined : members;

  const [comments, setComments] = useState<ReviewCommentDTO[]>(initialComments);
  const [composing, setComposing] = useState<{ anchor: ReviewAnchor } | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const threads = useMemo(() => comments.filter((c) => !c.parentId), [comments]);
  const repliesOf = useMemo(() => {
    const m = new Map<string, ReviewCommentDTO[]>();
    for (const c of comments) if (c.parentId) m.set(c.parentId, [...(m.get(c.parentId) ?? []), c]);
    return m;
  }, [comments]);
  const countByAnchor = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of threads) if (t.status === "open") m.set(anchorKey(parseAnchor(t.anchor)), (m.get(anchorKey(parseAnchor(t.anchor))) ?? 0) + 1);
    return m;
  }, [threads]);

  const screenIndex = useMemo(() => new Map(snapshot?.screens.map((s, i) => [s.id, i]) ?? []), [snapshot]);
  const screenTitle = (id: string) => {
    const i = screenIndex.get(id);
    return i === undefined ? "A removed screen" : `${i + 1}. ${snapshot!.screens[i].title}`;
  };

  // File rounds: number each pinned thread in the order it was left.
  const isPdf = round.file?.mimeType === "application/pdf";
  const isVideo = !!round.file?.mimeType.startsWith("video/");
  // Pins on a page or image, and moments in a video, numbered together in the order they
  // were left (a round has one file, so in practice it's one kind or the other).
  const { pins, videoPins } = useMemo(() => {
    const pins: FilePin[] = [];
    const videoPins: VideoPin[] = [];
    let n = 0;
    for (const t of threads) {
      const a = parseAnchor(t.anchor);
      if (!isFileAnchor(a) && !isVideoAnchor(a)) continue;
      n++;
      const base = { threadId: t.id, number: n, open: t.status === "open", label: `Comment ${n}${t.author ? ` by ${t.author.name}` : ""}` };
      if (isVideoAnchor(a)) videoPins.push({ ...base, anchor: a });
      else pins.push({ ...base, anchor: a });
    }
    return { pins, videoPins };
  }, [threads]);
  const pinNumber = useMemo(() => new Map([...pins, ...videoPins].map((p) => [p.threadId, p.number])), [pins, videoPins]);

  /** The jump-to label on a thread, or null for a comment on the whole round. */
  function labelFor(threadId: string, a: ReviewAnchor): string | null {
    if (a.kind === "storyboard_field") return `${screenTitle(a.screenId)} · ${SCREEN_FIELD_LABEL[a.field]}`;
    if (isVideoAnchor(a)) return `${timecode(a.t)} · #${pinNumber.get(threadId) ?? "?"}`;
    if (!isFileAnchor(a)) return null;
    const where = isPdf ? `Page ${a.page}` : "Image";
    const whole = a.kind === "file_region" && a.w === 1 && a.h === 1;
    return whole ? where : `${where} · #${pinNumber.get(threadId) ?? "?"}`;
  }

  const [highlight, setHighlight] = useState<string | null>(focusThread);
  // A linked thread that's already closed would be hidden under "Open".
  const [tab, setTab] = useState<Tab>(() =>
    focusThread && initialComments.some((c) => c.id === focusThread && c.status !== "open") ? "all" : "open",
  );
  useEffect(() => {
    if (!focusThread) return;
    requestAnimationFrame(() => document.getElementById(`thread-${focusThread}`)?.scrollIntoView({ block: "center" }));
    const t = setTimeout(() => setHighlight((h) => (h === focusThread ? null : h)), 2500);
    return () => clearTimeout(t);
  }, [focusThread]);
  function selectThread(threadId: string) {
    setHighlight(threadId);
    // A pin on a resolved thread: show it, even if the panel was on "Open".
    if (tab === "open" && threads.some((t) => t.id === threadId && t.status !== "open")) setTab("all");
    requestAnimationFrame(() => document.getElementById(`thread-${threadId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    setTimeout(() => setHighlight((h) => (h === threadId ? null : h)), 1800);
  }

  function jumpTo(a: ReviewAnchor, threadId?: string) {
    if (isVideoAnchor(a)) {
      if (!threadId) return;
      const id = pinDomId(threadId);
      requestAnimationFrame(() => {
        document.getElementById(id)?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
        setFlash(id);
        setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
      });
      return;
    }
    if (isFileAnchor(a)) {
      const whole = a.kind === "file_region" && a.w === 1 && a.h === 1;
      const id = whole || !threadId ? pageDomId(a.page) : pinDomId(threadId);
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlash(id);
        setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
      });
      return;
    }
    if (a.kind !== "storyboard_field") return;
    if (onlyChanged && diff?.screens[a.screenId]?.kind === "unchanged") setOnlyChanged(false);
    const id = fieldDomId(a.screenId, a.field);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlash(id);
      setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
    });
  }

  async function post(anchor: ReviewAnchor, body: string, parentId?: string) {
    const res = guest
      ? await guestAddComment(viewer.id, anchor, body, parentId ?? null)
      : await addReviewComment(round.id, anchor, body, parentId ?? null);
    if (res && "comment" in res && res.comment) {
      setComments((prev) => [...prev, res.comment!]);
      if (!parentId) setComposing(null);
      return null;
    }
    return res && "error" in res ? res.error ?? "Couldn't post that comment." : null;
  }

  const myAssignment = guest ? null : (assignments.find((a) => a.reviewer?.id === me.id) ?? null);
  const approved = assignments.filter((a) => isApproval(a.status)).length;
  const changedCount = diff?.changedCount ?? 0;
  const visibleScreens =
    snapshot?.screens.filter((s) => !onlyChanged || !diff || diff.screens[s.id]?.kind !== "unchanged") ?? [];

  return (
    <div className="flex min-h-screen min-w-0 flex-col gap-4 px-6 pt-5 pb-10">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[14rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {deliverable.name} <span className="text-muted-foreground">· Round {round.number}</span>
            </h1>
            <StatusBadge tone={roundTone(round.outcome)}>
              {round.overridden && <ShieldCheck className="size-3" aria-hidden="true" />}
              {roundLabel(round.outcome, !!round.overridden)}
            </StatusBadge>
            {round.dueDate && !round.outcome && <DueChip iso={round.dueDate} className="text-xs font-medium" />}
          </div>
          <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
            {guest ? (
              <span>{project.name}</span>
            ) : (
              <Link href={`/projects/${project.id}`} className="hover:text-foreground hover:underline">{project.name}</Link>
            )}
            {round.requestedBy && <span>· requested by {round.requestedBy}</span>}
            <span>· {approved}/{assignments.length} approved</span>
          </p>
        </div>
        {viewer.kind === "member" && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/reviews/feedback/${deliverable.id}`}>
                <ListChecks className="size-4" aria-hidden="true" /> All feedback
              </Link>
            </Button>
            <ExportMenu wordHref={`/api/review-rounds/${round.id}/export`} printHref={`/print/reviews/${round.id}`} />
            {canOverride && round.outcome !== "passed" && <OverrideButton roundId={round.id} approved={approved} total={assignments.length} />}
          </div>
        )}
      </header>

      {round.overridden && (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          <ShieldCheck className="mr-1.5 inline size-4 text-accent" aria-hidden="true" />
          <span className="font-semibold">Passed by override</span>{" "}
          <span className="text-muted-foreground">
            — {round.overridden.by}, <When iso={round.overridden.at} />, with {approved} of {assignments.length} approved:
          </span>{" "}
          “{round.overridden.reason}”
        </p>
      )}

      <ReviewerList assignments={assignments} roundOpen={!round.outcome} manage={viewer.kind === "member"} roundId={round.id} members={members} />
      {myAssignment && <DecisionBar assignment={myAssignment} />}
      {viewer.kind === "guest" && (
        <GuestDecisionBar
          viewer={viewer}
          assignment={assignments.find((a) => a.guest?.id === viewer.id) ?? null}
          howTo={
            round.file
              ? isVideo
                ? "Play to a moment and choose Comment at it, or pin a comment on the frame."
                : `Click or tap the ${round.file.mimeType === "application/pdf" ? "pages" : "image"} to pin a comment.`
              : "Select text in any field and press Comment to quote it."
          }
        />
      )}

      <div className="flex min-w-0 flex-wrap items-start gap-6">
        {/* ── What's under review ───────────────────────────── */}
        <section
          aria-label={round.file ? "File under review" : "Storyboard under review"}
          className="flex min-w-0 flex-[999_1_34rem] flex-col gap-3"
        >
          {round.previousFile && round.file && (
            <p className="rounded-md bg-info/10 px-3 py-2 text-sm">
              {round.previousFile.same
                ? `Same file as round ${round.previousFile.number}.`
                : `New version — round ${round.previousFile.number} reviewed “${round.previousFile.fileName}”.`}
            </p>
          )}
          {round.file && isVideo ? (
            <VideoReview
              file={round.file}
              pins={videoPins}
              canComment={canComment}
              composingAnchor={composing && isVideoAnchor(composing.anchor) ? composing.anchor : null}
              flash={flash}
              onCompose={(anchor) => setComposing({ anchor })}
              onSelectPin={selectThread}
              composer={
                composing &&
                isVideoAnchor(composing.anchor) && (
                  <Composer
                    anchor={composing.anchor}
                    members={mentionMembers}
                    onCancel={() => setComposing(null)}
                    onPost={(anchor, body) => post(anchor, body)}
                  />
                )
              }
            />
          ) : round.file ? (
            <FileReview
              file={round.file}
              pins={pins}
              canComment={canComment}
              composingAnchor={composing && isFileAnchor(composing.anchor) ? composing.anchor : null}
              flash={flash}
              onCompose={(anchor) => setComposing({ anchor })}
              onSelectPin={selectThread}
              composer={
                composing && (
                  <Composer
                    anchor={composing.anchor}
                    members={mentionMembers}
                    onCancel={() => setComposing(null)}
                    onPost={(anchor, body) => post(anchor, body)}
                  />
                )
              }
            />
          ) : snapshot ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">
                  {snapshot.title} <span className="font-normal text-muted-foreground">· {snapshot.screens.length} screens, as of this round</span>
                </h2>
                {diff && previousNumber != null && (
                  <div role="group" aria-label="Which screens" className="ml-auto flex rounded-md bg-muted p-0.5">
                    <Toggle active={!onlyChanged} onClick={() => setOnlyChanged(false)}>All screens</Toggle>
                    <Toggle active={onlyChanged} onClick={() => setOnlyChanged(true)}>
                      Changed since round {previousNumber} · {changedCount}
                    </Toggle>
                  </div>
                )}
              </div>
              {diff && diff.removed.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Removed since round {previousNumber}: {diff.removed.map((r) => r.title).join(", ")}
                </p>
              )}
              {onlyChanged && visibleScreens.length === 0 && (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  Nothing changed since round {previousNumber}.
                </p>
              )}
              {visibleScreens.map((s) => (
                <ScreenCard
                  key={s.id}
                  index={screenIndex.get(s.id)! + 1}
                  screen={s}
                  change={diff?.screens[s.id] ?? null}
                  previousNumber={previousNumber}
                  countByAnchor={countByAnchor}
                  flash={flash}
                  composing={composing}
                  members={mentionMembers}
                  canComment={canComment}
                  onCompose={(anchor) => setComposing({ anchor })}
                  onCancel={() => setComposing(null)}
                  onPost={(anchor, body) => post(anchor, body)}
                />
              ))}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              {round.hasStoryboardNow
                ? "This round was started before Tavoro recorded what each round reviewed, so there's no snapshot to show. Comments still work — use the panel."
                : guest
                  ? "There's nothing to pin comments to in this round. Leave your feedback in the comments panel."
                  : "This deliverable has no storyboard, so there's nothing to pin comments to. Leave feedback for the round in the panel."}
            </div>
          )}
        </section>

        {/* ── Comments ─────────────────────────────────────── */}
        <CommentsPanel
          threads={threads}
          repliesOf={repliesOf}
          me={me}
          viewer={viewer}
          canComment={canComment}
          members={mentionMembers}
          labelFor={labelFor}
          highlight={highlight}
          tab={tab}
          setTab={setTab}
          onJump={jumpTo}
          onPost={post}
          deliverableId={deliverable.id}
          onUpdate={(c) => setComments((prev) => prev.map((x) => (x.id === c.id ? c : x)))}
          onLinked={(linked) =>
            setComments((prev) => prev.map((x) => ({ ...x, card: linked.find((l) => l.commentId === x.id)?.card ?? x.card })))
          }
          onDelete={(id) => setComments((prev) => prev.filter((x) => x.id !== id && x.parentId !== id))}
        />
      </div>
    </div>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-7 rounded px-2.5 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** The current user's own decision on this round. */
function DecisionBar({ assignment }: { assignment: Assignment }) {
  const [summary, setSummary] = useState(assignment.feedback ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const decided = isDecided(assignment.status);

  function decide(status: ReviewDecision | "in_review") {
    setError(null);
    startTransition(async () => {
      if (summary.trim() !== (assignment.feedback ?? "").trim()) await setReviewFeedback(assignment.id, summary);
      // The action revalidates this page, which re-renders it with the new decision.
      // A router.refresh() on top raced that update and could leave it stale.
      const res = await setReviewStatus(assignment.id, status);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <section aria-label="Your decision" className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/5 p-4">
      <h2 className="text-sm font-semibold">
        {decided ? `You chose “${DECISION_PAST[assignment.status]}” — you can still change your decision` : "Your decision"}
      </h2>
      <Textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={2}
        placeholder="Summary for the designer (optional) — pin specific feedback to screens below"
        aria-label="Decision summary"
        className="resize-none bg-surface"
      />
      {error && <p role="alert" className="text-sm text-destructive-ink">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <DecisionButtons onDecide={decide} pending={pending} />
        {assignment.status === "requested" && (
          <Button size="sm" variant="ghost" onClick={() => decide("in_review")} disabled={pending}>
            Mark in review
          </Button>
        )}
      </div>
    </section>
  );
}

const DECISION_PAST: Record<string, string> = {
  approved: "Approve",
  approved_with_changes: "Approve with minor changes",
  changes_requested: "Request changes",
};

function DecisionButtons({ onDecide, pending }: { onDecide: (d: ReviewDecision) => void; pending: boolean }) {
  return (
    <>
      <Button size="sm" onClick={() => onDecide("approved")} disabled={pending}>
        <Check className="size-4" aria-hidden="true" /> Approve
      </Button>
      <Button size="sm" variant="outline" onClick={() => onDecide("approved_with_changes")} disabled={pending}>
        <CheckCheck className="size-4" aria-hidden="true" /> Approve with minor changes
      </Button>
      <Button size="sm" variant="outline" onClick={() => onDecide("changes_requested")} disabled={pending}>
        <RotateCcw className="size-4" aria-hidden="true" /> Request changes
      </Button>
    </>
  );
}

/** A guest's decision, from their review link. Once they've decided, the page is
 *  read-only until they reopen — which they can do until the round closes. */
function GuestDecisionBar({
  viewer,
  assignment,
  howTo,
}: {
  viewer: Extract<Viewer, { kind: "guest" }>;
  assignment: Assignment | null;
  howTo: string;
}) {
  const [summary, setSummary] = useState(assignment?.feedback ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!assignment) return null;
  const decided = isDecided(assignment.status);

  function run(fn: () => Promise<{ error?: string } | void>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && res.error) setError(res.error);
    });
  }

  if (viewer.superseded || viewer.closed) {
    return (
      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
        {viewer.superseded
          ? "A newer round of this review has started, so this one is read-only. Check your email for the latest link."
          : "This round is closed — thank you for your review. You can still read everything here."}
        {decided && <> You chose <span className="font-medium text-foreground">{DECISION_PAST[assignment.status]}</span>.</>}
      </p>
    );
  }

  if (decided) {
    return (
      <section aria-label="Your decision" className="flex flex-wrap items-center gap-3 rounded-lg border border-success/40 bg-success/5 p-4">
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">Thanks — you chose “{DECISION_PAST[assignment.status]}”.</span>{" "}
          <span className="text-muted-foreground">The team has been told. Need to add something? Reopen your decision.</span>
          {assignment.feedback && <span className="mt-1 block text-muted-foreground">“{assignment.feedback}”</span>}
        </p>
        {error && <p role="alert" className="text-sm text-destructive-ink">{error}</p>}
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => guestReopen(viewer.id))}>
          <Undo2 className="size-4" aria-hidden="true" /> Reopen
        </Button>
      </section>
    );
  }

  return (
    <section aria-label="Your decision" className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/5 p-4">
      <h2 className="text-sm font-semibold">When you&apos;re done, {viewer.name.split(" ")[0]}, hand down your decision</h2>
      <p className="text-xs text-muted-foreground">
        {howTo} This link is personal to you and works until{" "}
        <time dateTime={viewer.expiresAt} suppressHydrationWarning>
          <LocalTime iso={viewer.expiresAt} format="longDay" />
        </time>
        .
      </p>
      <Textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={2}
        placeholder="Overall summary (optional)"
        aria-label="Decision summary"
        className="resize-none bg-surface"
      />
      {error && <p role="alert" className="text-sm text-destructive-ink">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <DecisionButtons pending={pending} onDecide={(d) => run(() => guestDecide(viewer.id, d, summary))} />
      </div>
    </section>
  );
}

function OverrideButton({ roundId, approved, total }: { roundId: string; approved: number; total: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await overrideReviewRound(roundId, reason);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ShieldCheck className="size-4" aria-hidden="true" /> Override…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pass this round anyway?</DialogTitle>
            <DialogDescription>
              {approved} of {total} reviewers have approved. An override passes the round now; reviewers&apos; own
              decisions stay as they are, and the reason is shown on the round.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor="override-reason" className="text-sm font-medium">Reason</label>
            <Textarea
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. SME out until after launch; content signed off by the compliance lead instead."
              required
            />
            {error && <p role="alert" className="text-sm text-destructive-ink">{error}</p>}
            <DialogFooter className="mt-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending || reason.trim().length < 3}>
                {pending ? "Overriding…" : "Pass by override"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChangeBadge({ change, previousNumber }: { change: ScreenChange | null; previousNumber: number | null }) {
  if (!change || change.kind === "unchanged" || previousNumber == null) return null;
  return (
    <span className="rounded bg-info/10 px-1.5 py-0.5 text-[11px] font-semibold text-info">
      {change.kind === "added" ? `New since round ${previousNumber}` : `Changed since round ${previousNumber}`}
    </span>
  );
}

function ScreenCard({
  index,
  screen,
  change,
  previousNumber,
  countByAnchor,
  flash,
  composing,
  members,
  canComment,
  onCompose,
  onCancel,
  onPost,
}: {
  index: number;
  screen: StoryboardSnapshot["screens"][number];
  change: ScreenChange | null;
  previousNumber: number | null;
  countByAnchor: Map<string, number>;
  flash: string | null;
  composing: { anchor: ReviewAnchor } | null;
  members: MentionMember[] | undefined;
  canComment: boolean;
  onCompose: (anchor: ReviewAnchor) => void;
  onCancel: () => void;
  onPost: (anchor: ReviewAnchor, body: string) => Promise<string | null>;
}) {
  const fields = SCREEN_FIELDS.filter((f) => hasText(screen.fields[f]));
  const changedFields = change?.kind === "changed" ? new Set(change.fields) : null;

  return (
    <article className="rounded-lg border border-border bg-surface" aria-labelledby={`screen-${screen.id}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="font-mono text-xs text-muted-foreground">{index}</span>
        <h3 id={`screen-${screen.id}`} className="font-semibold">{screen.title}</h3>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {SCREEN_TYPE_LABEL[screen.screenType] ?? screen.screenType}
        </span>
        <ChangeBadge change={change} previousNumber={previousNumber} />
      </header>
      {fields.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">No content on this screen yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {fields.map((f) => {
            const anchor: ReviewAnchor = { kind: "storyboard_field", screenId: screen.id, field: f };
            const key = anchorKey(anchor);
            const open = countByAnchor.get(key) ?? 0;
            const id = fieldDomId(screen.id, f);
            const isComposing =
              composing?.anchor.kind === "storyboard_field" &&
              composing.anchor.screenId === screen.id &&
              composing.anchor.field === f;
            return (
              <div key={f} className="group/field px-4 py-3">
                <div
                  id={id}
                  className={cn(
                    "-mx-2 rounded-md px-2 py-1 transition-colors",
                    changedFields?.has(f) && "border-l-2 border-info pl-2.5",
                    flash === id && "bg-accent/10",
                  )}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">{SCREEN_FIELD_LABEL[f]}</span>
                    {changedFields?.has(f) && <span className="text-[11px] font-semibold text-info">Changed</span>}
                    {open > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <MessageSquare className="size-3.5" aria-hidden="true" />
                        {open}
                        <span className="sr-only"> open comment{open === 1 ? "" : "s"}</span>
                      </span>
                    )}
                    {canComment && (
                    <button
                      type="button"
                      // Keep the reader's text selection alive so it can become the quote.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const sel = window.getSelection();
                        const box = document.getElementById(id);
                        let quote: string | null = null;
                        if (sel && !sel.isCollapsed && box && box.contains(sel.anchorNode) && box.contains(sel.focusNode)) {
                          quote = sel.toString().replace(/\s+/g, " ").trim().slice(0, 500) || null;
                        }
                        onCompose(quote ? { ...anchor, quote: { exact: quote } } : anchor);
                      }}
                      className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground opacity-70 outline-none hover:bg-hover hover:text-foreground focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 group-hover/field:opacity-100"
                      title="Comment — select text first to quote it"
                    >
                      <MessageSquarePlus className="size-3.5" aria-hidden="true" />
                      Comment<span className="sr-only"> on {SCREEN_FIELD_LABEL[f]}, screen {index}</span>
                    </button>
                    )}
                  </div>
                  <CommentBody body={screen.fields[f] ?? ""} />
                </div>
                {isComposing && composing && (
                  <Composer anchor={composing.anchor} members={members} onCancel={onCancel} onPost={onPost} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function Composer({
  anchor,
  members,
  onCancel,
  onPost,
  label = "Comment",
}: {
  anchor: ReviewAnchor;
  members: MentionMember[] | undefined;
  onCancel?: () => void;
  onPost: (anchor: ReviewAnchor, body: string) => Promise<string | null>;
  label?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const quote = quoteOf(anchor);
  const spot = quote
    ? null
    : isVideoAnchor(anchor)
    ? `${anchor.x !== undefined ? "Pinned comment" : "Comment"} at ${timecode(anchor.t)}`
    : isFileAnchor(anchor)
    ? anchor.kind === "file_point"
      ? "Pinned comment"
      : anchor.w === 1 && anchor.h === 1
        ? "Comment on the whole page"
        : "Comment on the marked area"
    : null;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {quote && (
        <blockquote className="border-l-2 border-accent pl-2 text-xs text-muted-foreground">“{quote}”</blockquote>
      )}
      {spot && <p className="text-xs font-medium text-muted-foreground">{spot}</p>}
      <CommentComposer
        mentionMembers={members}
        buttonLabel={label}
        onSubmit={async (json) => {
          setError(await onPost(anchor, json));
        }}
      />
      {error && <p role="alert" className="text-sm text-destructive-ink">{error}</p>}
      {onCancel && (
        <Button size="xs" variant="ghost" className="w-fit" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}

type Tab = "open" | "closed" | "all";

function CommentsPanel({
  threads,
  repliesOf,
  me,
  viewer,
  canComment,
  members,
  labelFor,
  highlight,
  tab,
  setTab,
  onJump,
  onPost,
  deliverableId,
  onUpdate,
  onLinked,
  onDelete,
}: {
  threads: ReviewCommentDTO[];
  repliesOf: Map<string, ReviewCommentDTO[]>;
  me: { id: string };
  viewer: Viewer;
  canComment: boolean;
  members: MentionMember[] | undefined;
  labelFor: (threadId: string, a: ReviewAnchor) => string | null;
  highlight: string | null;
  tab: Tab;
  setTab: (t: Tab) => void;
  onJump: (a: ReviewAnchor, threadId?: string) => void;
  onPost: (anchor: ReviewAnchor, body: string, parentId?: string) => Promise<string | null>;
  deliverableId: string;
  onUpdate: (c: ReviewCommentDTO) => void;
  onLinked: (linked: LinkedComment[]) => void;
  onDelete: (id: string) => void;
}) {
  const open = threads.filter((t) => t.status === "open");
  const closed = threads.filter((t) => t.status !== "open");
  const shown = tab === "open" ? open : tab === "closed" ? closed : threads;

  return (
    <aside
      aria-label="Comments"
      className="flex w-full min-w-0 flex-[1_1_22rem] flex-col gap-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:max-w-md lg:overflow-y-auto"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Comments</h2>
        <div role="tablist" aria-label="Filter comments" className="ml-auto flex rounded-md bg-muted p-0.5">
          {(
            [
              ["open", `Open · ${open.length}`],
              ["closed", `Closed · ${closed.length}`],
              ["all", "All"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                "h-7 rounded px-2.5 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                tab === k ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {canComment && (
        <div className="rounded-lg border border-border bg-surface p-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {viewer.kind === "guest" ? "General feedback, not tied to one screen" : "Comment on the round as a whole"}
          </p>
          <Composer anchor={GENERAL_ANCHOR} members={members} onPost={(a, b) => onPost(a, b)} />
        </div>
      )}

      {shown.length === 0 && (
        <p className="px-1 text-sm text-muted-foreground">
          {tab === "open" ? "No open comments." : tab === "closed" ? "Nothing resolved yet." : "No comments yet."}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {shown.map((t) => (
          <Thread
            key={t.id}
            thread={t}
            replies={repliesOf.get(t.id) ?? []}
            me={me}
            viewer={viewer}
            canComment={canComment}
            members={members}
            label={labelFor(t.id, parseAnchor(t.anchor))}
            highlighted={highlight === t.id}
            onJump={onJump}
            onReply={(body) => onPost(parseAnchor(t.anchor), body, t.id)}
            deliverableId={deliverableId}
            onUpdate={onUpdate}
            onLinked={onLinked}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </aside>
  );
}

const CLOSED_LABEL: Record<string, string> = { resolved: "Resolved", wont_fix: "Won't fix" };

function Thread({
  thread,
  replies,
  me,
  viewer,
  canComment,
  members,
  label,
  highlighted,
  onJump,
  onReply,
  deliverableId,
  onUpdate,
  onLinked,
  onDelete,
}: {
  thread: ReviewCommentDTO;
  replies: ReviewCommentDTO[];
  me: { id: string };
  viewer: Viewer;
  canComment: boolean;
  members: MentionMember[] | undefined;
  label: string | null;
  highlighted: boolean;
  onJump: (a: ReviewAnchor, threadId?: string) => void;
  onReply: (body: string) => Promise<string | null>;
  deliverableId: string;
  onUpdate: (c: ReviewCommentDTO) => void;
  onLinked: (linked: LinkedComment[]) => void;
  onDelete: (id: string) => void;
}) {
  const anchor = parseAnchor(thread.anchor);
  const [replying, setReplying] = useState(false);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState<"resolved" | "wont_fix" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setStatus(status: "open" | "resolved" | "wont_fix") {
    setError(null);
    startTransition(async () => {
      const res = await setReviewCommentStatus(thread.id, status, status === "open" ? null : note);
      if (res && "comment" in res && res.comment) {
        onUpdate(res.comment);
        setClosing(null);
        setNote("");
      } else if (res && "error" in res) setError(res.error ?? "Couldn't update.");
    });
  }

  function remove(c: ReviewCommentDTO) {
    startTransition(async () => {
      const res = viewer.kind === "guest" ? await guestDeleteComment(viewer.id, c.id) : await deleteReviewComment(c.id);
      if (res?.error) setError(res.error);
      else onDelete(c.id);
    });
  }

  const member = viewer.kind === "member";
  const canDelete = (c: ReviewCommentDTO) =>
    member ? c.author?.id === me.id || viewer.canModerate : canComment && c.author?.id === me.id;

  return (
    <li
      id={`thread-${thread.id}`}
      className={cn(
        "scroll-mt-20 rounded-lg border bg-surface p-3 transition-shadow",
        thread.status === "open" ? "border-border" : "border-border opacity-80",
        highlighted && "border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]",
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
        {label ? (
          <button
            type="button"
            onClick={() => onJump(anchor, thread.id)}
            className="font-medium text-accent underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {label}
          </button>
        ) : (
          <span className="font-medium text-muted-foreground">Whole round</span>
        )}
        {thread.status !== "open" && (
          <StatusBadge tone={thread.status === "resolved" ? "success" : "neutral"}>
            {thread.status === "resolved" ? <Check className="size-3" aria-hidden="true" /> : <CircleSlash className="size-3" aria-hidden="true" />}
            {CLOSED_LABEL[thread.status] ?? thread.status}
          </StatusBadge>
        )}
        {thread.card && <CardChip card={thread.card} />}
      </div>
      {quoteOf(anchor) && (
        <blockquote className="mb-1.5 flex gap-1.5 border-l-2 border-accent/60 pl-2 text-xs text-muted-foreground">
          <Quote className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          {quoteOf(anchor)}
        </blockquote>
      )}

      <CommentItem comment={thread} canDelete={canDelete(thread)} onDelete={() => remove(thread)} />
      {replies.map((r) => (
        <div key={r.id} className="mt-2 border-l-2 border-border pl-3">
          <CommentItem comment={r} canDelete={canDelete(r)} onDelete={() => remove(r)} />
        </div>
      ))}

      {thread.status !== "open" && (thread.resolvedBy || thread.resolvedNote) && (
        <p className="mt-2 rounded bg-muted px-2 py-1.5 text-xs">
          <span className="font-medium">{thread.resolvedBy ?? "Someone"}</span>
          {thread.resolvedNote ? `: ${thread.resolvedNote}` : " closed this"}
        </p>
      )}

      {error && <p role="alert" className="mt-1 text-xs text-destructive-ink">{error}</p>}

      {closing ? (
        <form
          className="mt-2 flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            setStatus(closing);
          }}
        >
          <Input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={closing === "resolved" ? "What changed? (optional)" : "Why not? (optional)"}
            aria-label="Note for the reviewer"
            className="h-8 text-sm"
          />
          <div className="flex gap-2">
            <Button size="xs" type="submit" disabled={pending}>
              {closing === "resolved" ? "Resolve" : "Won't fix"}
            </Button>
            <Button size="xs" type="button" variant="ghost" onClick={() => setClosing(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          {canComment && (
            <Button size="xs" variant="ghost" onClick={() => setReplying((r) => !r)}>Reply</Button>
          )}
          {!member ? null : thread.status === "open" ? (
            <>
              <Button size="xs" variant="ghost" onClick={() => setClosing("resolved")}>
                <Check className="size-3" aria-hidden="true" /> Resolve
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setClosing("wont_fix")}>
                <CircleSlash className="size-3" aria-hidden="true" /> Won&apos;t fix
              </Button>
              {!thread.card && (
                <Button size="xs" variant="ghost" onClick={() => setSending(true)}>
                  <SquareKanban className="size-3" aria-hidden="true" /> Send to board
                </Button>
              )}
            </>
          ) : (
            <Button size="xs" variant="ghost" onClick={() => setStatus("open")} disabled={pending}>
              <Undo2 className="size-3" aria-hidden="true" /> Reopen
            </Button>
          )}
        </div>
      )}
      {sending && (
        <SendToBoardDialog
          deliverableId={deliverableId}
          commentIds={[thread.id]}
          onClose={() => setSending(false)}
          onSent={(r) => onLinked(r.linked)}
        />
      )}
      {replying && (
        <div className="mt-1">
          <CommentComposer
            mentionMembers={members}
            buttonLabel="Reply"
            onSubmit={async (json) => {
              const err = await onReply(json);
              if (err) setError(err);
              else setReplying(false);
            }}
          />
        </div>
      )}
    </li>
  );
}

function CommentItem({
  comment,
  canDelete,
  onDelete,
}: {
  comment: ReviewCommentDTO;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="group/comment">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold">{comment.author ? comment.author.name : "Former reviewer"}</span>
        {comment.author?.guest && (
          <span className="rounded bg-muted px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Guest</span>
        )}
        <span className="text-muted-foreground"><When iso={comment.createdAt} /></span>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive-ink focus-visible:opacity-100 group-hover/comment:opacity-100"
            aria-label="Delete comment"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      <div className="mt-0.5">
        <CommentBody body={comment.body} />
      </div>
    </div>
  );
}
