// Content inventory + lifecycle (docs/CONTENT-LIFECYCLE-REUSE.md, phases 0–1): the
// vocabulary and the one rule for "is this item current?". Pure — no server-only
// imports — because the worker's reminder scan uses it too.

export const CONTENT_TYPES = ["course", "job_aid", "video", "assessment", "document", "other"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  course: "Course",
  job_aid: "Job aid",
  video: "Video",
  assessment: "Assessment",
  document: "Document",
  other: "Other",
};

// "retired" is archival: hidden from the inventory by default, never deleted, so the
// record of what once shipped survives.
export const CONTENT_STATUSES = ["draft", "published", "needs_review", "retired"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  draft: "Draft",
  published: "Published",
  needs_review: "Needs review",
  retired: "Retired",
};

/** Review cadences offered in the UI (months). */
export const REVIEW_INTERVALS = [3, 6, 12, 24] as const;

/** How many days ahead counts as "coming up" on the inventory and My Work. */
export const SOON_DAYS = 30;

// Reminder stages, in days before the date. Expiry gets more notice than a review:
// replacing expiring content takes longer than looking it over.
export const REVIEW_STAGES = [30, 7, 0] as const;
export const EXPIRY_STAGES = [60, 30, 7, 0] as const;

export type Lifecycle =
  | "retired"
  | "expired"
  | "expiring"
  | "review_overdue"
  | "review_due"
  | "needs_review"
  | "current"
  | "undated";

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  retired: "Retired",
  expired: "Expired",
  expiring: "Expiring soon",
  review_overdue: "Review overdue",
  review_due: "Review due soon",
  needs_review: "Needs review",
  current: "Current",
  undated: "No dates set",
};

export const LIFECYCLE_TONE: Record<Lifecycle, "neutral" | "info" | "success" | "warning" | "danger"> = {
  retired: "neutral",
  expired: "danger",
  expiring: "warning",
  review_overdue: "danger",
  review_due: "warning",
  needs_review: "warning",
  current: "success",
  undated: "neutral",
};

/** Lifecycle filters for the inventory, most urgent first. */
export const ATTENTION: Lifecycle[] = ["expired", "review_overdue", "expiring", "review_due", "needs_review"];

const DAY = 86_400_000;

/** Whole days from today (UTC) to `date`: 0 = today, negative = past. Dates are stored
 *  as UTC midnight, so comparing calendar days avoids off-by-hours surprises. */
export function daysUntil(date: Date | string, now = new Date()): number {
  const d = new Date(date);
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / DAY);
}

type Dated = { status: string; reviewDate: Date | string | null; expiryDate: Date | string | null };

/** The item's state, most urgent wins: an expired course matters more than a late review. */
export function lifecycleOf(item: Dated, now = new Date()): Lifecycle {
  if (item.status === "retired") return "retired";
  const expiry = item.expiryDate == null ? null : daysUntil(item.expiryDate, now);
  const review = item.reviewDate == null ? null : daysUntil(item.reviewDate, now);
  if (expiry != null && expiry < 0) return "expired";
  if (review != null && review < 0) return "review_overdue";
  if (expiry != null && expiry <= SOON_DAYS) return "expiring";
  if (review != null && review <= SOON_DAYS) return "review_due";
  if (item.status === "needs_review") return "needs_review";
  return expiry == null && review == null ? "undated" : "current";
}

/** The reminder stage a date has reached: the tightest stage at or above the days left,
 *  e.g. 25 days out with stages [30, 7, 0] → "30". Null before the first stage, and
 *  after the date has passed (an overdue item shows on the inventory; it isn't mailed
 *  every day). */
export function stageFor(days: number, stages: readonly number[]): string | null {
  if (days < 0) return null;
  let hit: number | null = null;
  for (const s of stages) if (days <= s) hit = s;
  return hit == null ? null : String(hit);
}

/** A date `months` after `from`, at UTC midnight. */
export function addMonths(from: Date, months: number): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, from.getUTCDate()));
}

/** "in 12 days", "today", "3 days ago". */
export function relativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** A calendar date ("Jan 31, 2027"). Stored at UTC midnight, so formatted in UTC: in
 *  local time, anyone west of Greenwich would see the day before. */
export function formatDay(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/** The date as the YYYY-MM-DD an <input type="date"> takes. */
export function dayValue(date: Date | string | null | undefined): string {
  return date ? new Date(date).toISOString().slice(0, 10) : "";
}
