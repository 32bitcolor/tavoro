import "server-only";
import { prisma } from "@/lib/db";
import { median } from "@/lib/reports";
import type { CommentState } from "@/lib/suite-reviews";

// SME turnaround for reviews made in CourseForge (docs/SUITE.md, step 4): how long reviewers'
// comments take to be resolved, per review card and per reviewer. A comment is "made" when the
// reviewer wrote it and "resolved" when it was resolved in CourseForge or ticked here.

const DAY = 86_400_000;

export interface CourseReviewRow {
  key: string;
  label: string;
  /** Opens the review card. */
  href: string | null;
  comments: number;
  resolved: number;
  open: number;
  medianDays: number | null;
  /** Age in days of the oldest comment still open. */
  oldestOpenDays: number | null;
}

export interface CourseReviewReport {
  comments: number;
  resolved: number;
  open: number;
  medianDays: number | null;
  oldestOpenDays: number | null;
  byReview: CourseReviewRow[];
  byReviewer: CourseReviewRow[];
}

export async function loadCourseReviewReport(
  workspaceId: string,
  since: Date,
  now: Date,
): Promise<CourseReviewReport> {
  const items = await prisma.suiteItem.findMany({
    where: {
      kind: "review-comment",
      cardId: { not: null },
      app: { workspaceId },
    },
    select: {
      createdAt: true,
      state: true,
      card: {
        select: {
          parentCard: {
            select: {
              id: true,
              title: true,
              keySeq: true,
              column: {
                select: {
                  board: { select: { id: true, cardKeyPrefix: true } },
                },
              },
            },
          },
        },
      },
    },
    take: 5000,
  });

  type Acc = { row: CourseReviewRow; turn: number[]; oldest: number | null };
  const acc = (
    m: Map<string, Acc>,
    key: string,
    label: string,
    href: string | null,
  ) => {
    let a = m.get(key);
    if (!a)
      m.set(
        key,
        (a = {
          row: {
            key,
            label,
            href,
            comments: 0,
            resolved: 0,
            open: 0,
            medianDays: null,
            oldestOpenDays: null,
          },
          turn: [],
          oldest: null,
        }),
      );
    return a;
  };
  const reviews = new Map<string, Acc>();
  const reviewers = new Map<string, Acc>();
  const all: Acc = {
    row: {
      key: "all",
      label: "",
      href: null,
      comments: 0,
      resolved: 0,
      open: 0,
      medianDays: null,
      oldestOpenDays: null,
    },
    turn: [],
    oldest: null,
  };

  for (const it of items) {
    const st = (it.state ?? {}) as unknown as CommentState;
    const made = new Date(st.commentAt ?? it.createdAt);
    const parent = it.card?.parentCard;
    if (!parent) continue;
    // In the window: made since its start, or still waiting (an old open comment is the point of the report).
    if (made < since && st.resolved) continue;
    const board = parent.column?.board;
    const key =
      board && parent.keySeq != null && board.cardKeyPrefix
        ? `${board.cardKeyPrefix}-${parent.keySeq}`
        : null;
    const label =
      (key ? `${key} ` : "") + parent.title.replace(/^Review:\s*/, "");
    const href = board ? `/boards/${board.id}?card=${parent.id}` : null;
    const name = (st.author ?? "A reviewer").trim() || "A reviewer";
    const targets = [
      all,
      acc(reviews, parent.id, label, href),
      acc(reviewers, name.toLowerCase(), name, null),
    ];
    const resolvedAt = st.resolved && st.resolvedAt ? new Date(st.resolvedAt) : null;
    for (const a of targets) {
      a.row.comments++;
      if (st.resolved) {
        a.row.resolved++;
        // Resolved before the time was recorded: counted, but there is no turnaround to average.
        if (resolvedAt) a.turn.push(Math.max(0, (resolvedAt.getTime() - made.getTime()) / DAY));
      } else {
        a.row.open++;
        const age = (now.getTime() - made.getTime()) / DAY;
        a.oldest = a.oldest === null ? age : Math.max(a.oldest, age);
      }
    }
  }
  const fin = (a: Acc): CourseReviewRow => ({
    ...a.row,
    medianDays: median(a.turn),
    oldestOpenDays: a.oldest,
  });
  const sorted = (m: Map<string, Acc>) =>
    [...m.values()]
      .map(fin)
      .sort(
        (x, y) =>
          y.open - x.open ||
          y.comments - x.comments ||
          x.label.localeCompare(y.label),
      );
  const total = fin(all);
  return {
    comments: total.comments,
    resolved: total.resolved,
    open: total.open,
    medianDays: total.medianDays,
    oldestOpenDays: total.oldestOpenDays,
    byReview: sorted(reviews),
    byReviewer: sorted(reviewers),
  };
}
