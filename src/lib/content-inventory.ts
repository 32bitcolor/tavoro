import "server-only";
import { prisma } from "@/lib/db";
import { ATTENTION, daysUntil, lifecycleOf, relativeDays, type Lifecycle } from "@/lib/content";
import type { Prisma } from "@/generated/prisma/client";

// Reading the content inventory: the list page, My Work, the dashboard and MCP all go
// through here so "what needs attention" means the same thing everywhere. Lifecycle is
// computed from the dates rather than stored, so it is never stale; a workspace's
// inventory is small enough to compute in memory.

export const CONTENT_SELECT = {
  id: true,
  title: true,
  description: true,
  contentType: true,
  status: true,
  externalUrl: true,
  publishedAt: true,
  reviewDate: true,
  reviewIntervalMonths: true,
  lastReviewedAt: true,
  expiryDate: true,
  updatedAt: true,
  owner: { select: { id: true, name: true, email: true } },
  project: { select: { id: true, name: true } },
  deliverable: { select: { id: true, name: true } },
  labels: { select: { label: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.ContentItemSelect;

type Row = Prisma.ContentItemGetPayload<{ select: typeof CONTENT_SELECT }>;

export type ContentRow = Omit<Row, "labels"> & {
  labels: { id: string; name: string; color: string }[];
  lifecycle: Lifecycle;
  /** The next date that matters (review or expiry, whichever is sooner), for sorting. */
  nextDate: Date | null;
};

function toRow(r: Row, now: Date): ContentRow {
  const dates = [r.reviewDate, r.expiryDate].filter((d): d is Date => d != null);
  const nextDate = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  return { ...r, labels: r.labels.map((l) => l.label), lifecycle: lifecycleOf(r, now), nextDate };
}

const URGENCY: Record<Lifecycle, number> = {
  expired: 0,
  review_overdue: 1,
  expiring: 2,
  review_due: 3,
  needs_review: 4,
  current: 5,
  undated: 6,
  retired: 7,
};

/** Most urgent first, then soonest date, then title. */
function byUrgency(a: ContentRow, b: ContentRow) {
  return (
    URGENCY[a.lifecycle] - URGENCY[b.lifecycle] ||
    (a.nextDate?.getTime() ?? Infinity) - (b.nextDate?.getTime() ?? Infinity) ||
    a.title.localeCompare(b.title)
  );
}

export type ContentFilters = {
  q?: string;
  type?: string;
  status?: string; // a status, or "all" (default hides retired)
  lifecycle?: string; // a Lifecycle, or "attention" for any of ATTENTION
  ownerId?: string;
  labelId?: string;
};

export async function listContent(workspaceId: string, f: ContentFilters = {}): Promise<ContentRow[]> {
  const now = new Date();
  const where: Prisma.ContentItemWhereInput = {
    workspaceId,
    ...(f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }] } : {}),
    ...(f.type ? { contentType: f.type } : {}),
    ...(f.status === "all" ? {} : f.status ? { status: f.status } : { status: { not: "retired" } }),
    ...(f.ownerId ? { ownerId: f.ownerId } : {}),
    ...(f.labelId ? { labels: { some: { labelId: f.labelId } } } : {}),
  };
  const rows = (await prisma.contentItem.findMany({ where, select: CONTENT_SELECT })).map((r) => toRow(r, now));
  const wanted =
    f.lifecycle === "attention" ? new Set<string>(ATTENTION) : f.lifecycle ? new Set([f.lifecycle]) : null;
  return (wanted ? rows.filter((r) => wanted.has(r.lifecycle)) : rows).sort(byUrgency);
}

/** How many live items are in each attention state. */
export async function attentionCounts(workspaceId: string): Promise<Record<Lifecycle, number> & { total: number }> {
  const now = new Date();
  const rows = await prisma.contentItem.findMany({
    where: { workspaceId, status: { not: "retired" } },
    select: { status: true, reviewDate: true, expiryDate: true },
  });
  const counts = { expired: 0, review_overdue: 0, expiring: 0, review_due: 0, needs_review: 0, current: 0, undated: 0, retired: 0, total: rows.length };
  for (const r of rows) counts[lifecycleOf(r, now)]++;
  return counts;
}

/** Items this person owns that need attention now or soon, for My Work. */
export async function myContentAttention(userId: string, workspaceId: string): Promise<ContentRow[]> {
  return listContent(workspaceId, { ownerId: userId, lifecycle: "attention" });
}

/** "Review due in 12 days" / "Expired 3 days ago" — the one-line reason an item is listed. */
export function attentionReason(r: Pick<ContentRow, "lifecycle" | "reviewDate" | "expiryDate">, now = new Date()): string | null {
  const rel = (d: Date) => relativeDays(daysUntil(d, now));
  switch (r.lifecycle) {
    case "expired":
      return `Expired ${rel(r.expiryDate!)}`;
    case "expiring":
      return `Expires ${rel(r.expiryDate!)}`;
    case "review_overdue":
      return `Review was due ${rel(r.reviewDate!)}`;
    case "review_due":
      return `Review due ${rel(r.reviewDate!)}`;
    case "needs_review":
      return "Marked as needing review";
    default:
      return null;
  }
}
