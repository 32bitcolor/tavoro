import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/dal";
import { getDeliverableForUser, getReviewRoundForUser, projectVisibilityWhere } from "@/lib/authz";
import { parseAnchor, SCREEN_FIELDS, type ReviewAnchor } from "@/lib/review-anchor";
import { parseSnapshot } from "@/lib/review-snapshot";
import { COMMENT_SELECT, toCommentDTO } from "@/lib/review-comments";
import { describePlace, pinNumbers, quoteOf } from "@/lib/review-feedback";
import { REVIEW_STATUS_LABEL, type ReviewStatus } from "@/lib/methodology";
import { addReviewComment, setReviewFeedback, setReviewStatus, startReviewRound } from "@/app/actions/reviews";
import { listBoardTargets, sendCommentsToBoard, setReviewCommentsStatus } from "@/app/actions/review-feedback";
import { toMarkdown, fromMarkdown } from "@/lib/markdown";
import { check, day, link, parseDate, principal, tool, ToolError } from "@/lib/mcp/util";
import { resolveMember } from "@/lib/mcp/tools/cards";

const FIELD_BY_ARG: Record<string, (typeof SCREEN_FIELDS)[number]> = {
  on_screen_text: "onScreenText",
  narration: "narration",
  visuals: "visualNotes",
  interaction: "interactionNotes",
  developer_notes: "developerNotes",
};

function outcomeOf(outcome: string | null) {
  return outcome ?? "in_review";
}

export async function loadRound(roundId: string, includeContent: boolean) {
  if (!(await getReviewRoundForUser(roundId))) throw new ToolError("Review round not found, or you can't see it.");
  const r = await prisma.reviewRound.findUniqueOrThrow({
    where: { id: roundId },
    select: {
      id: true,
      number: true,
      targetKind: true,
      snapshot: true,
      outcome: true,
      overrideReason: true,
      dueDate: true,
      createdAt: true,
      file: { select: { id: true, fileName: true, mimeType: true } },
      createdBy: { select: { name: true, email: true } },
      deliverable: { select: { id: true, name: true, project: { select: { id: true, name: true } } } },
      assignments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          feedback: true,
          decidedAt: true,
          reviewer: { select: { id: true, name: true, email: true } },
          guest: { select: { name: true, email: true } },
        },
      },
      comments: { orderBy: { createdAt: "asc" }, select: COMMENT_SELECT },
    },
  });
  const snapshot = parseSnapshot(r.snapshot);
  const isPdf = r.file?.mimeType === "application/pdf";
  const threads = r.comments.filter((c) => !c.parentId);
  const pins = pinNumbers(threads.map((t) => ({ id: t.id, anchor: parseAnchor(t.anchor) })));
  return {
    id: r.id,
    round: r.number,
    url: link(`/reviews/${r.id}`),
    deliverable: { id: r.deliverable.id, name: r.deliverable.name },
    project: r.deliverable.project,
    outcome: outcomeOf(r.outcome),
    overrideReason: r.overrideReason,
    due: day(r.dueDate),
    requestedBy: r.createdBy ? (r.createdBy.name ?? r.createdBy.email) : null,
    reviewing: r.file ? { kind: isPdf ? "pdf" : "image", fileName: r.file.fileName } : snapshot ? { kind: "storyboard", title: snapshot.title } : { kind: "none" },
    reviewers: r.assignments.map((a) => ({
      assignmentId: a.id,
      name: a.reviewer ? (a.reviewer.name ?? a.reviewer.email) : (a.guest?.name ?? "Former reviewer"),
      guest: !a.reviewer,
      decision: REVIEW_STATUS_LABEL[a.status as ReviewStatus] ?? a.status,
      summary: a.feedback,
      decidedAt: day(a.decidedAt),
    })),
    comments: threads.map((t) => {
      const dto = toCommentDTO(t, "member");
      const anchor = parseAnchor(t.anchor);
      return {
        id: t.id,
        where: describePlace(anchor, { snapshot, isPdf, pinNumber: pins.get(t.id) }),
        quote: quoteOf(anchor) ?? null,
        author: dto.author ? `${dto.author.name}${dto.author.guest ? " (guest)" : ""}` : "Former reviewer",
        at: dto.createdAt,
        status: dto.status,
        resolution: dto.status === "open" ? null : `${dto.resolvedBy ?? "Someone"}${dto.resolvedNote ? `: ${dto.resolvedNote}` : ""}`,
        body: toMarkdown(t.body),
        card: dto.card,
        replies: r.comments
          .filter((c) => c.parentId === t.id)
          .map((c) => ({ id: c.id, author: c.author ? (c.author.name ?? c.author.email) : (c.guest?.name ?? "Former reviewer"), at: c.createdAt.toISOString(), body: toMarkdown(c.body) })),
      };
    }),
    ...(includeContent && snapshot
      ? {
          storyboardAsReviewed: snapshot.screens.map((s, i) => ({
            screenId: s.id,
            number: i + 1,
            title: s.title,
            type: s.screenType,
            ...Object.fromEntries(Object.entries(FIELD_BY_ARG).map(([arg, f]) => [arg, toMarkdown(s.fields[f])])),
          })),
        }
      : {}),
  };
}

/** The anchor for a new comment, from the friendly arguments. */
async function anchorFor(
  roundId: string,
  a: { screen?: string; field?: string; quote?: string; page?: number; at?: string },
): Promise<ReviewAnchor> {
  const round = await prisma.reviewRound.findUniqueOrThrow({ where: { id: roundId }, select: { snapshot: true, fileId: true, file: { select: { mimeType: true } } } });
  if (a.at != null) {
    if (!round.file?.mimeType.startsWith("video/")) throw new ToolError("at is for rounds that review a video.");
    const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?$|^(\d+(?:\.\d+)?)$/.exec(a.at.trim());
    if (!m) throw new ToolError('at must be a time like "1:23", "1:02:03" or seconds like "83".');
    const t = m[4] != null ? Number(m[4]) : Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    return { kind: "video_time", t };
  }
  if (a.page != null) {
    if (!round.fileId) throw new ToolError("This round reviews a storyboard, not a file; use screen and field.");
    return { kind: "file_region", page: a.page, x: 0, y: 0, w: 1, h: 1, ...(a.quote ? { quote: { exact: a.quote.slice(0, 500) } } : {}) };
  }
  if (a.screen) {
    const snapshot = parseSnapshot(round.snapshot);
    if (!snapshot) throw new ToolError("This round has no storyboard to comment on; leave screen out for a general comment.");
    const s = a.screen.trim();
    const screen =
      snapshot.screens.find((x) => x.id === s) ??
      (/^\d+$/.test(s) ? snapshot.screens[Number(s) - 1] : undefined) ??
      snapshot.screens.find((x) => x.title.toLowerCase() === s.toLowerCase());
    if (!screen) throw new ToolError(`No screen "${a.screen}" in this round. Use its number, title or id.`);
    const field = FIELD_BY_ARG[a.field ?? "on_screen_text"];
    if (!field) throw new ToolError(`field must be one of ${Object.keys(FIELD_BY_ARG).join(", ")}.`);
    return { kind: "storyboard_field", screenId: screen.id, field, ...(a.quote ? { quote: { exact: a.quote.slice(0, 500) } } : {}) };
  }
  return { kind: "general" };
}

export function registerReviewTools(server: McpServer) {
  tool(
    server,
    "list_reviews",
    {
      title: "List review rounds",
      description: "Review rounds in the workspace (newest first): deliverable, outcome, due date, each reviewer's decision, and open comment count.",
      input: {
        scope: z.enum(["open", "all"]).default("open").describe("open = rounds still waiting on decisions"),
        deliverable_id: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(30),
      },
      kind: "read",
    },
    async ({ scope, deliverable_id, limit }) => {
      const rounds = await prisma.reviewRound.findMany({
        where: {
          ...(scope === "open" ? { outcome: null } : {}),
          ...(deliverable_id ? { deliverableId: deliverable_id } : {}),
          deliverable: { project: { workspaceId: principal().workspaceId, ...(await projectVisibilityWhere()) } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          number: true,
          outcome: true,
          dueDate: true,
          deliverable: { select: { id: true, name: true, project: { select: { name: true } } } },
          assignments: { select: { status: true, reviewer: { select: { name: true, email: true } }, guest: { select: { name: true } } } },
          _count: { select: { comments: { where: { parentId: null, status: "open" } } } },
        },
      });
      return rounds.map((r) => ({
        roundId: r.id,
        round: r.number,
        deliverable: r.deliverable.name,
        deliverableId: r.deliverable.id,
        project: r.deliverable.project.name,
        outcome: outcomeOf(r.outcome),
        due: day(r.dueDate),
        reviewers: r.assignments.map((a) => `${a.reviewer ? (a.reviewer.name ?? a.reviewer.email) : `${a.guest?.name} (guest)`}: ${REVIEW_STATUS_LABEL[a.status as ReviewStatus] ?? a.status}`),
        openComments: r._count.comments,
        url: link(`/reviews/${r.id}`),
      }));
    },
  );

  tool(
    server,
    "get_review_round",
    {
      title: "Get a review round",
      description:
        "One review round: what's under review, each reviewer's decision and summary, and every comment thread (where it's pinned, quoted text, status, replies, linked card). With include_content, also the storyboard exactly as it was reviewed.",
      input: { round_id: z.string().min(1), include_content: z.boolean().default(false) },
      kind: "read",
    },
    ({ round_id, include_content }) => loadRound(round_id, include_content),
  );

  tool(
    server,
    "get_deliverable_feedback",
    {
      title: "All feedback on a deliverable",
      description: "Every review comment on a deliverable across all its rounds, newest round first, with where each one is pinned and whether it's on a board yet.",
      input: { deliverable_id: z.string().min(1), status: z.enum(["open", "closed", "all"]).default("open") },
      kind: "read",
    },
    async ({ deliverable_id, status }) => {
      if (!(await getDeliverableForUser(deliverable_id))) throw new ToolError("Deliverable not found, or you can't see it.");
      const rounds = await prisma.reviewRound.findMany({ where: { deliverableId: deliverable_id }, orderBy: { number: "desc" }, select: { id: true } });
      const out = [];
      for (const r of rounds) {
        const round = await loadRound(r.id, false);
        for (const c of round.comments) {
          if (status === "open" ? c.status !== "open" : status === "closed" ? c.status === "open" : false) continue;
          out.push({ round: round.round, roundId: round.id, ...c });
        }
      }
      return { deliverableId: deliverable_id, url: link(`/reviews/feedback/${deliverable_id}`), comments: out };
    },
  );

  tool(
    server,
    "add_review_comment",
    {
      title: "Comment on a review round",
      description:
        "Leave a comment on a review round as you. Pin it to a storyboard screen and field (screen = number, title or id; field = on_screen_text, narration, visuals, interaction or developer_notes; quote = text it refers to), to a page of a reviewed PDF, to a moment of a reviewed video (at = \"1:23\"), or leave them out for a general comment. Set parent_id to reply to a thread.",
      input: {
        round_id: z.string().min(1),
        body: z.string().min(1).max(20000).describe("Markdown"),
        screen: z.string().optional(),
        field: z.enum(["on_screen_text", "narration", "visuals", "interaction", "developer_notes"]).optional(),
        quote: z.string().max(500).optional(),
        page: z.number().int().min(1).optional(),
        at: z.string().max(12).optional().describe('For a video round: the moment, e.g. "1:23", "1:02:03" or seconds'),
        parent_id: z.string().optional(),
      },
      kind: "write",
    },
    async (a) => {
      const anchor = a.parent_id ? { kind: "general" as const } : await anchorFor(a.round_id, a);
      const res = check(await addReviewComment(a.round_id, anchor, fromMarkdown(a.body)!, a.parent_id ?? null));
      return { ok: true, commentId: res.comment?.id, url: link(`/reviews/${a.round_id}?thread=${a.parent_id ?? res.comment?.id}`) };
    },
  );

  tool(
    server,
    "set_review_comment_status",
    {
      title: "Resolve, won't-fix or reopen review comments",
      description: "Close review threads as resolved or won't fix (with an optional note the reviewer sees), or reopen them.",
      input: { comment_ids: z.array(z.string()).min(1).max(200), status: z.enum(["resolved", "wont_fix", "open"]), note: z.string().max(1000).optional() },
      kind: "write",
      idempotent: true,
    },
    async ({ comment_ids, status, note }) => check(await setReviewCommentsStatus(comment_ids, status, note ?? null)),
  );

  tool(
    server,
    "decide_review",
    {
      title: "Decide on a review",
      description:
        "Record your own decision on a review round you're a reviewer of: approved, approved_with_changes, or changes_requested (or in_review to reopen it), with an optional summary. The requester is emailed.",
      input: {
        round_id: z.string().min(1),
        decision: z.enum(["approved", "approved_with_changes", "changes_requested", "in_review"]),
        summary: z.string().max(5000).optional(),
      },
      kind: "write",
      idempotent: true,
    },
    async ({ round_id, decision, summary }) => {
      const me = (await getCurrentUser())!;
      const mine = await prisma.reviewCycle.findFirst({ where: { roundId: round_id, reviewerId: me.id }, select: { id: true } });
      if (!mine) throw new ToolError("You aren't a reviewer on this round.");
      if (summary !== undefined) check(await setReviewFeedback(mine.id, summary));
      check(await setReviewStatus(mine.id, decision));
      const round = await loadRound(round_id, false);
      return { ok: true, outcome: round.outcome, reviewers: round.reviewers };
    },
  );

  tool(
    server,
    "start_review_round",
    {
      title: "Start a review round",
      description:
        "Start the next review round on a deliverable, reviewing its linked storyboard (frozen as it is now). Reviewers are workspace members (ids, emails or names) and/or guests (name + email, who get a personal link by email). Everyone is emailed. Reviewing a PDF or image needs the upload in the app.",
      input: {
        deliverable_id: z.string().min(1),
        reviewers: z.array(z.string()).max(20).default([]),
        guests: z.array(z.object({ name: z.string().min(1).max(120), email: z.string().email() })).max(20).default([]),
        due: z.string().optional().describe("YYYY-MM-DD"),
      },
      kind: "write",
    },
    async ({ deliverable_id, reviewers, guests, due }) => {
      const memberIds = [];
      for (const r of reviewers) memberIds.push((await resolveMember(r)).id);
      const res = check(await startReviewRound(deliverable_id, { memberIds, guests }, parseDate(due), undefined));
      return loadRound(res.roundId!, false);
    },
  );

  tool(
    server,
    "send_comments_to_board",
    {
      title: "Send review comments to a board",
      description:
        "Turn review comments (thread ids from one deliverable) into board cards: one card per comment, or one card with a subtask per comment (checklist). Each card quotes the comment and links back. Comments already on a board are skipped. Board and column default to the deliverable's project board and its first column.",
      input: {
        comment_ids: z.array(z.string()).min(1).max(100),
        board_id: z.string().optional(),
        column: z.string().optional().describe("Column name or id"),
        mode: z.enum(["each", "checklist"]).default("each"),
        title: z.string().max(280).optional().describe("Checklist card title"),
      },
      kind: "write",
    },
    async ({ comment_ids, board_id, column, mode, title }) => {
      const first = await prisma.reviewComment.findUnique({ where: { id: comment_ids[0] }, select: { round: { select: { deliverableId: true } } } });
      if (!first) throw new ToolError("Comment not found.");
      const targets = check(await listBoardTargets(first.round.deliverableId));
      const board = targets.boards!.find((b) => b.id === (board_id ?? targets.defaultBoardId));
      if (!board) throw new ToolError(`Pick a board_id. Boards: ${targets.boards!.map((b) => `${b.name} (${b.id})`).join(", ") || "none"}.`);
      const col = column ? board.columns.find((c) => c.id === column || c.name.toLowerCase() === column.toLowerCase()) : board.columns[0];
      if (!col) throw new ToolError(`No column "${column}" on ${board.name}. Columns: ${board.columns.map((c) => c.name).join(", ")}.`);
      const res = check(await sendCommentsToBoard({ commentIds: comment_ids, columnId: col.id, mode, title }));
      return {
        created: res.created,
        skipped: res.skipped,
        board: board.name,
        column: col.name,
        cards: res.linked?.map((l) => ({ commentId: l.commentId, card: l.card.key ?? l.card.id, url: link(`/boards/${l.card.boardId}?card=${l.card.id}`) })),
      };
    },
  );
}
