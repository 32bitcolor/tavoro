import { isFileAnchor, isPinnedAnchor, isVideoAnchor, SCREEN_FIELD_LABEL, timecode, type ReviewAnchor } from "@/lib/review-anchor";
import type { StoryboardSnapshot } from "@/lib/review-snapshot";
import { extractText } from "@/lib/mentions";

// Feedback becomes work (docs/REVIEW-LINKS.md, phase 4): the words that describe where
// a comment sits, and the card a comment turns into. Shared by the send-to-board
// action, the deliverable's feedback page and the Word/PDF export, so a comment reads
// the same everywhere.

/** Where a comment sits, in words: "3. Phishing basics · Narration", "Page 2 · #4",
 *  "At 1:23 · #2". */
export function describePlace(
  anchor: ReviewAnchor,
  ctx: { snapshot: StoryboardSnapshot | null; isPdf: boolean; pinNumber?: number },
): string {
  if (anchor.kind === "storyboard_field") {
    const i = ctx.snapshot?.screens.findIndex((s) => s.id === anchor.screenId) ?? -1;
    const screen = i >= 0 ? `${i + 1}. ${ctx.snapshot!.screens[i].title}` : "A removed screen";
    return `${screen} · ${SCREEN_FIELD_LABEL[anchor.field]}`;
  }
  if (isVideoAnchor(anchor)) return `At ${timecode(anchor.t)}${ctx.pinNumber == null ? "" : ` · #${ctx.pinNumber}`}`;
  if (isFileAnchor(anchor)) {
    const where = ctx.isPdf ? `Page ${anchor.page}` : "Image";
    const whole = anchor.kind === "file_region" && anchor.w === 1 && anchor.h === 1;
    return whole || ctx.pinNumber == null ? where : `${where} · #${ctx.pinNumber}`;
  }
  return "Whole round";
}

/** Pin numbers as the round page shows them: file-anchored threads, in the order
 *  they were left. */
export function pinNumbers(threads: { id: string; anchor: ReviewAnchor }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of threads) if (isPinnedAnchor(t.anchor)) out.set(t.id, out.size + 1);
  return out;
}

export function quoteOf(a: ReviewAnchor): string | undefined {
  return a.kind === "storyboard_field" || a.kind === "file_region" ? a.quote?.exact : undefined;
}

export function excerpt(body: string, max: number): string {
  const text = extractText(body);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The round page, scrolled to one thread. */
export function threadPath(roundId: string, commentId: string): string {
  return `/reviews/${roundId}?thread=${commentId}`;
}

export function feedbackPath(deliverableId: string): string {
  return `/reviews/feedback/${deliverableId}`;
}

// ── Card descriptions (TipTap JSON, as the card editor stores them) ──────────

type Node = Record<string, unknown>;
const text = (t: string, marks?: Node[]): Node => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
const para = (...content: Node[]): Node => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const link = (t: string, href: string) => text(t, [{ type: "link", attrs: { href, target: null, rel: null } }]);
const italic = (t: string) => text(t, [{ type: "italic" }]);

/** A comment's words as plain paragraphs. Mentions become "@Name" text: the card
 *  editor may not have the mention extension loaded, and a guest never mentions. */
function bodyParagraphs(body: string): Node[] {
  const out: Node[] = [];
  try {
    const doc = JSON.parse(body) as { content?: Node[] };
    for (const block of doc.content ?? []) {
      const t = extractText(JSON.stringify(block));
      if (t) out.push(para(text(t)));
    }
  } catch {
    if (body.trim()) out.push(para(text(body.trim())));
  }
  return out;
}

export type CommentForCard = {
  id: string;
  roundId: string;
  roundNumber: number;
  body: string;
  anchor: ReviewAnchor;
  place: string;
  author: string;
};

/** The description of a card made from one comment: the quote, what the reviewer
 *  said, who and where, and a link back to the thread. */
export function cardDescriptionForComment(c: CommentForCard, deliverableName: string): string {
  const quote = quoteOf(c.anchor);
  const content: Node[] = [];
  if (quote) content.push({ type: "blockquote", content: [para(text(quote))] });
  content.push(...bodyParagraphs(c.body));
  content.push(
    para(
      italic(`${c.author} · ${deliverableName}, round ${c.roundNumber} · ${c.place}. `),
      link("Open the comment in the review", threadPath(c.roundId, c.id)),
    ),
  );
  return JSON.stringify({ type: "doc", content });
}

/** The description of one card holding several comments as a checklist. */
export function cardDescriptionForChecklist(count: number, deliverable: { id: string; name: string }, rounds: number[]): string {
  const which = rounds.length === 1 ? `round ${rounds[0]}` : `rounds ${rounds.join(", ")}`;
  return JSON.stringify({
    type: "doc",
    content: [
      para(text(`${count} review comment${count === 1 ? "" : "s"} on ${deliverable.name} (${which}), one subtask each. `)),
      para(link("See all feedback for this deliverable", feedbackPath(deliverable.id))),
    ],
  });
}
