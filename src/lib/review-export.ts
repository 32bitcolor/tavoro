import "server-only";
import { prisma } from "@/lib/db";
import { isFileAnchor, isVideoAnchor, parseAnchor, SCREEN_FIELDS, SCREEN_FIELD_LABEL, timecode, type ReviewAnchor } from "@/lib/review-anchor";
import { parseSnapshot, type StoryboardSnapshot } from "@/lib/review-snapshot";
import { memberName } from "@/lib/review-comments";
import { pinNumbers, quoteOf } from "@/lib/review-feedback";
import { REVIEW_STATUS_LABEL, type ReviewStatus } from "@/lib/methodology";
import { toBlocks, type Block } from "@/lib/rich-text";

// Exports (docs/REVIEW-LINKS.md, phase 4): a storyboard, or a review round with its
// comments beside what they're about, as one neutral document that lib/docx.ts writes
// as Word and the /print pages render for the browser's "Save as PDF".

export type ExportComment = {
  /** Where, when it isn't obvious from the section: "Pin #3", "Whole page". */
  place: string | null;
  author: string;
  date: string;
  status: "open" | "resolved" | "wont_fix";
  quote: string | null;
  body: Block[];
  replies: { author: string; date: string; body: Block[] }[];
  /** "Resolved by Maya Chen: reworded the narration". */
  resolution: string | null;
};

export type ExportField = { label: string; body: Block[]; comments: ExportComment[] };

export type ExportSection = {
  heading: string;
  /** A small label beside the heading: the screen type, "Changed since round 1". */
  tags: string[];
  fields: ExportField[];
  /** Comments on the section as a whole (file pages, general feedback). */
  comments: ExportComment[];
  /** A line under the heading, e.g. why a section is empty. */
  note?: string;
};

export type ExportDoc = {
  fileName: string; // without extension
  title: string;
  subtitle: string;
  meta: [string, string][];
  reviewers: { name: string; decision: string; summary: string | null }[];
  sections: ExportSection[];
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

const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "export";
}

function screenSections(snapshot: Pick<StoryboardSnapshot, "screens">): ExportSection[] {
  return snapshot.screens.map((s, i) => ({
    heading: `${i + 1}. ${s.title}`,
    tags: [SCREEN_TYPE_LABEL[s.screenType] ?? s.screenType],
    fields: SCREEN_FIELDS.map((f) => ({ label: SCREEN_FIELD_LABEL[f], body: toBlocks(s.fields[f]), comments: [] as ExportComment[] })),
    comments: [],
  }));
}

/** A live storyboard, screen by screen. Empty fields are left out. */
export async function storyboardExport(storyboardId: string): Promise<ExportDoc | null> {
  const sb = await prisma.storyboard.findUnique({
    where: { id: storyboardId },
    select: {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
      description: true,
      deliverable: { select: { name: true, project: { select: { name: true } } } },
      screens: {
        orderBy: { position: "asc" },
        select: {
          id: true, title: true, screenType: true,
          onScreenText: true, narration: true, visualNotes: true, interactionNotes: true, developerNotes: true,
        },
      },
    },
  });
  if (!sb) return null;
  const sections = screenSections({
    screens: sb.screens.map((s) => ({
      id: s.id,
      title: s.title,
      screenType: s.screenType,
      fields: Object.fromEntries(SCREEN_FIELDS.map((f) => [f, s[f]])) as StoryboardSnapshot["screens"][number]["fields"],
    })),
  });
  for (const s of sections) s.fields = s.fields.filter((f) => f.body.length > 0);
  const meta: [string, string][] = [];
  if (sb.deliverable) meta.push(["Project", `${sb.deliverable.project.name} · ${sb.deliverable.name}`]);
  meta.push(["Status", sb.status.replace("_", " ")], ["Screens", String(sb.screens.length)], ["Exported", fmt(new Date())]);
  return {
    fileName: safeFileName(`${sb.title} - storyboard`),
    title: sb.title,
    subtitle: "Storyboard",
    meta,
    reviewers: [],
    sections,
  };
}

/** A review round: what was reviewed, each reviewer's decision, and every comment
 *  placed beside the field or page it's about. */
export async function roundExport(roundId: string): Promise<ExportDoc | null> {
  const round = await prisma.reviewRound.findUnique({
    where: { id: roundId },
    select: {
      number: true,
      snapshot: true,
      outcome: true,
      overrideReason: true,
      dueDate: true,
      createdAt: true,
      file: { select: { fileName: true, mimeType: true } },
      createdBy: { select: { name: true, email: true } },
      deliverable: { select: { name: true, project: { select: { name: true } } } },
      assignments: {
        orderBy: { createdAt: "asc" },
        select: {
          status: true,
          feedback: true,
          reviewer: { select: { name: true, email: true } },
          guest: { select: { name: true } },
        },
      },
      comments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          parentId: true,
          body: true,
          anchor: true,
          status: true,
          resolvedNote: true,
          createdAt: true,
          author: { select: { name: true, email: true } },
          guest: { select: { name: true } },
          resolvedBy: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!round) return null;

  type Row = (typeof round.comments)[number];
  const who = (c: Pick<Row, "author" | "guest">) =>
    c.author ? memberName(c.author, "member") : c.guest ? `${c.guest.name} (guest)` : "Former reviewer";
  const threads = round.comments.filter((c) => !c.parentId);
  const anchors = new Map(threads.map((t) => [t.id, parseAnchor(t.anchor)]));
  const pins = pinNumbers(threads.map((t) => ({ id: t.id, anchor: anchors.get(t.id)! })));
  const isPdf = round.file?.mimeType === "application/pdf";

  function toComment(t: Row, place: string | null): ExportComment {
    const status = (["open", "resolved", "wont_fix"].includes(t.status) ? t.status : "open") as ExportComment["status"];
    const closer = t.resolvedBy ? memberName(t.resolvedBy, "member") : "Someone";
    return {
      place,
      author: who(t),
      date: fmt(t.createdAt),
      status,
      quote: quoteOf(anchors.get(t.id)!) ?? null,
      body: toBlocks(t.body),
      replies: round!.comments
        .filter((r) => r.parentId === t.id)
        .map((r) => ({ author: who(r), date: fmt(r.createdAt), body: toBlocks(r.body) })),
      resolution:
        status === "open"
          ? null
          : `${status === "resolved" ? "Resolved" : "Won't fix"} by ${closer}${t.resolvedNote ? `: ${t.resolvedNote}` : ""}`,
    };
  }

  const general: ExportSection = { heading: "General feedback", tags: [], fields: [], comments: [] };
  const sections: ExportSection[] = [];
  const snapshot = parseSnapshot(round.snapshot);

  if (round.file?.mimeType.startsWith("video/")) {
    // One section for the video, comments in time order.
    const video: ExportSection = { heading: "Video", tags: [], fields: [], comments: [] };
    const timed = threads
      .map((t) => ({ t, a: anchors.get(t.id)! }))
      .sort((x, y) => (isVideoAnchor(x.a) ? x.a.t : -1) - (isVideoAnchor(y.a) ? y.a.t : -1));
    for (const { t, a } of timed) {
      if (!isVideoAnchor(a)) general.comments.push(toComment(t, null));
      else video.comments.push(toComment(t, `At ${timecode(a.t)} · Pin #${pins.get(t.id)}`));
    }
    sections.push(video);
  } else if (round.file) {
    const pages = new Map<number, ExportSection>();
    const page = (n: number) => {
      if (!pages.has(n)) pages.set(n, { heading: isPdf ? `Page ${n}` : "Image", tags: [], fields: [], comments: [] });
      return pages.get(n)!;
    };
    for (const t of threads) {
      const a = anchors.get(t.id)!;
      if (!isFileAnchor(a)) {
        general.comments.push(toComment(t, null));
        continue;
      }
      const whole = a.kind === "file_region" && a.w === 1 && a.h === 1;
      page(a.page).comments.push(toComment(t, whole ? "Whole page" : `Pin #${pins.get(t.id)}`));
    }
    sections.push(...[...pages.entries()].sort((x, y) => x[0] - y[0]).map(([, s]) => s));
  } else if (snapshot) {
    const screens = screenSections(snapshot);
    const byScreen = new Map(snapshot.screens.map((s, i) => [s.id, screens[i]]));
    const removed: ExportSection = { heading: "Comments on screens no longer in this round", tags: [], fields: [], comments: [] };
    for (const t of threads) {
      const a: ReviewAnchor = anchors.get(t.id)!;
      if (a.kind !== "storyboard_field") {
        general.comments.push(toComment(t, null));
        continue;
      }
      const section = byScreen.get(a.screenId);
      const field = section?.fields.find((f) => f.label === SCREEN_FIELD_LABEL[a.field]);
      if (field) field.comments.push(toComment(t, null));
      else removed.comments.push(toComment(t, SCREEN_FIELD_LABEL[a.field]));
    }
    // A field is shown when it has words or comments.
    for (const s of screens) s.fields = s.fields.filter((f) => f.body.length > 0 || f.comments.length > 0);
    sections.push(...screens);
    if (removed.comments.length) sections.push(removed);
  } else {
    for (const t of threads) general.comments.push(toComment(t, null));
  }
  if (general.comments.length) sections.unshift(general);

  const open = threads.filter((t) => t.status === "open").length;
  const outcome =
    round.outcome === "passed"
      ? round.overrideReason
        ? `Passed by override: ${round.overrideReason}`
        : "Passed"
      : round.outcome === "changes_requested"
        ? "Changes requested"
        : "In review";
  const meta: [string, string][] = [
    ["Project", round.deliverable.project.name],
    ["Reviewing", round.file ? round.file.fileName : snapshot ? `${snapshot.title} (storyboard, as of this round)` : "No file or storyboard"],
    ["Outcome", outcome],
    ["Requested", `${fmt(round.createdAt)}${round.createdBy ? ` by ${memberName(round.createdBy, "member")}` : ""}`],
  ];
  if (round.dueDate) meta.push(["Due", fmt(round.dueDate)]);
  meta.push(["Comments", `${threads.length} (${open} open)`], ["Exported", fmt(new Date())]);

  return {
    fileName: safeFileName(`${round.deliverable.name} - review round ${round.number}`),
    title: round.deliverable.name,
    subtitle: `Review round ${round.number}`,
    meta,
    reviewers: round.assignments.map((a) => ({
      name: a.reviewer ? memberName(a.reviewer, "member") : a.guest ? `${a.guest.name} (guest)` : "Former reviewer",
      decision: REVIEW_STATUS_LABEL[a.status as ReviewStatus] ?? a.status,
      summary: a.feedback,
    })),
    sections,
  };
}

