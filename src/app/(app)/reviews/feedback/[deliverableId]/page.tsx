import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDeliverableForUser } from "@/lib/authz";
import { COMMENT_SELECT, toCommentDTO } from "@/lib/review-comments";
import { isFileAnchor, isVideoAnchor, parseAnchor, SCREEN_FIELD_LABEL, timecode } from "@/lib/review-anchor";
import { parseSnapshot, type StoryboardSnapshot } from "@/lib/review-snapshot";
import { pinNumbers, quoteOf } from "@/lib/review-feedback";
import { FeedbackView, type FeedbackGroup, type FeedbackItem } from "@/components/review/feedback-view";

export const metadata = { title: "Feedback · Tavoro" };

/** Every comment on a deliverable, across all its review rounds, grouped by the screen
 *  or page it's about (docs/REVIEW-LINKS.md, phase 4). */
export default async function DeliverableFeedbackPage({ params }: { params: Promise<{ deliverableId: string }> }) {
  const { deliverableId } = await params;
  if (!(await getDeliverableForUser(deliverableId))) notFound();

  const deliverable = await prisma.deliverable.findUniqueOrThrow({
    where: { id: deliverableId },
    select: {
      id: true,
      name: true,
      project: { select: { id: true, name: true } },
      reviewRounds: {
        orderBy: { number: "desc" },
        select: {
          id: true,
          number: true,
          outcome: true,
          snapshot: true,
          file: { select: { fileName: true, mimeType: true } },
          comments: { orderBy: { createdAt: "asc" }, select: { ...COMMENT_SELECT, roundId: true } },
        },
      },
    },
  });

  // Screens are named after the newest round that has them, and ordered as the newest
  // storyboard has them; screens since removed go after, in the order first seen.
  const screenName = new Map<string, string>();
  const screenOrder = new Map<string, number>();
  const latestSnapshot = deliverable.reviewRounds.map((r) => parseSnapshot(r.snapshot)).find(Boolean) ?? null;
  latestSnapshot?.screens.forEach((s, i) => screenOrder.set(s.id, i));
  for (const r of deliverable.reviewRounds) {
    parseSnapshot(r.snapshot)?.screens.forEach((s, i) => {
      if (!screenName.has(s.id)) screenName.set(s.id, `${i + 1}. ${s.title}`);
      if (!screenOrder.has(s.id)) screenOrder.set(s.id, 1000 + screenOrder.size);
    });
  }

  const groups = new Map<string, FeedbackGroup>();
  const items: FeedbackItem[] = [];
  for (const round of deliverable.reviewRounds) {
    const snapshot: StoryboardSnapshot | null = parseSnapshot(round.snapshot);
    const isPdf = round.file?.mimeType === "application/pdf";
    const threads = round.comments.filter((c) => !c.parentId);
    const pins = pinNumbers(threads.map((t) => ({ id: t.id, anchor: parseAnchor(t.anchor) })));
    for (const t of threads) {
      const anchor = parseAnchor(t.anchor);
      let group: FeedbackGroup;
      let detail: string;
      if (anchor.kind === "storyboard_field") {
        const inRound = snapshot?.screens.some((s) => s.id === anchor.screenId);
        group = {
          key: `screen:${anchor.screenId}`,
          label: screenName.get(anchor.screenId) ?? "A removed screen",
          order: screenOrder.get(anchor.screenId) ?? 5000,
        };
        detail = SCREEN_FIELD_LABEL[anchor.field] + (inRound ? "" : " (screen since removed)");
      } else if (isVideoAnchor(anchor)) {
        group = { key: "video", label: "Video", order: 10000 };
        detail = `At ${timecode(anchor.t)} · Pin #${pins.get(t.id)}`;
        if (round.file) detail += ` · ${round.file.fileName}`;
      } else if (isFileAnchor(anchor)) {
        group = isPdf
          ? { key: `page:${anchor.page}`, label: `Page ${anchor.page}`, order: 10000 + anchor.page }
          : { key: "image", label: "Image", order: 10000 };
        const whole = anchor.kind === "file_region" && anchor.w === 1 && anchor.h === 1;
        detail = whole ? "Whole page" : `Pin #${pins.get(t.id)}`;
        if (round.file) detail += ` · ${round.file.fileName}`;
      } else {
        group = { key: "general", label: "General feedback", order: -1 };
        detail = "Whole round";
      }
      if (!groups.has(group.key)) groups.set(group.key, group);
      const dto = toCommentDTO(t, "member");
      items.push({
        ...dto,
        groupKey: group.key,
        detail,
        quote: quoteOf(anchor) ?? null,
        roundId: round.id,
        roundNumber: round.number,
        replies: round.comments.filter((c) => c.parentId === t.id).map((c) => toCommentDTO(c, "member")),
      });
    }
  }

  return (
    <FeedbackView
      deliverable={{ id: deliverable.id, name: deliverable.name }}
      project={deliverable.project}
      rounds={deliverable.reviewRounds.map((r) => ({ id: r.id, number: r.number, outcome: r.outcome }))}
      groups={[...groups.values()].sort((a, b) => a.order - b.order)}
      items={items}
    />
  );
}
