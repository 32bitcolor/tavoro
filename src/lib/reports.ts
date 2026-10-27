import { prisma } from "@/lib/db";
import { OPEN_STATUSES } from "@/lib/intake";
import { DELIVERABLE_TYPE_LABEL, type DeliverableType } from "@/lib/methodology";

// Manager reports (Reports page). Every loader takes a workspace and a window and
// returns plain, already-aggregated numbers — the page only lays them out. Callers
// must have checked the viewer is an ADMIN or MANAGER: those roles see every
// project and board in the workspace, so the loaders don't apply group visibility.

export const REPORT_RANGES = [30, 90, 180, 365] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];
export const DEFAULT_RANGE: ReportRange = 90;

export function parseRange(raw: string | undefined): ReportRange {
  const n = Number(raw);
  return (REPORT_RANGES as readonly number[]).includes(n) ? (n as ReportRange) : DEFAULT_RANGE;
}

const DAY = 86_400_000;

export type Bucket = { start: Date; end: Date; label: string; value: number };

/** Weekly buckets (Monday-start, UTC) for windows up to 90 days, monthly beyond.
 *  The first bucket is clipped to the window start so counts match the totals. */
export function makeBuckets(since: Date, now: Date, days: number): Bucket[] {
  const out: Bucket[] = [];
  if (days <= 90) {
    const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    while (d <= now) {
      const end = new Date(d.getTime() + 7 * DAY);
      out.push({ start: new Date(Math.max(d.getTime(), since.getTime())), end, value: 0, label: shortDate(d) });
      d.setTime(end.getTime());
    }
  } else {
    const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1));
    while (d <= now) {
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      out.push({
        start: new Date(Math.max(d.getTime(), since.getTime())),
        end,
        value: 0,
        // Month only, plus the year where it changes (and on the first bar).
        label: d.toLocaleDateString("en-US", {
          month: "short",
          year: out.length === 0 || d.getUTCMonth() === 0 ? "numeric" : undefined,
          timeZone: "UTC",
        }),
      });
      d.setTime(end.getTime());
    }
  }
  return out;
}

function shortDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function fill(buckets: Bucket[], items: { at: Date; amount?: number }[]): Bucket[] {
  const out = buckets.map((b) => ({ ...b }));
  for (const it of items) {
    const b = out.find((x) => it.at >= x.start && it.at < x.end);
    if (b) b.value += it.amount ?? 1;
  }
  return out;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const days = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY;

type Person = { id: string; name: string };

async function people(workspaceId: string): Promise<Map<string, Person>> {
  const rows = await prisma.membership.findMany({
    where: { workspaceId },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  return new Map(rows.map((r) => [r.user.id, { id: r.user.id, name: r.user.name || r.user.email }]));
}

// ─── Intake ───────────────────────────────────────────────────────────────────

export async function loadIntakeReport(workspaceId: string, since: Date, now: Date, rangeDays: number) {
  const [submitted, decided, open, who] = await Promise.all([
    prisma.intakeRequest.findMany({ where: { workspaceId, createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.intakeRequest.findMany({
      where: { workspaceId, decidedAt: { gte: since }, status: { in: ["converted", "rejected"] } },
      select: { status: true, createdAt: true, decidedAt: true, decidedById: true },
    }),
    prisma.intakeRequest.findMany({
      where: { workspaceId, status: { in: [...OPEN_STATUSES] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, number: true, title: true, status: true, createdAt: true, assignedToId: true },
    }),
    people(workspaceId),
  ]);

  const approved = decided.filter((r) => r.status === "converted").length;
  const deciders = new Map<string, { person: Person; approved: number; rejected: number; days: number[] }>();
  for (const r of decided) {
    if (!r.decidedById || !r.decidedAt) continue;
    const person = who.get(r.decidedById) ?? { id: r.decidedById, name: "Former member" };
    const row = deciders.get(person.id) ?? { person, approved: 0, rejected: 0, days: [] };
    row[r.status === "converted" ? "approved" : "rejected"]++;
    row.days.push(days(r.createdAt, r.decidedAt));
    deciders.set(person.id, row);
  }

  return {
    submittedCount: submitted.length,
    decidedCount: decided.length,
    approvalRate: decided.length ? approved / decided.length : null,
    medianDaysToDecision: median(decided.filter((r) => r.decidedAt).map((r) => days(r.createdAt, r.decidedAt!))),
    openCount: open.length,
    perBucket: fill(makeBuckets(since, now, rangeDays), submitted.map((r) => ({ at: r.createdAt }))),
    waiting: open.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      status: r.status,
      ageDays: days(r.createdAt, now),
      assignee: r.assignedToId ? (who.get(r.assignedToId)?.name ?? "Former member") : null,
    })),
    deciders: [...deciders.values()]
      .map((d) => ({ name: d.person.name, approved: d.approved, rejected: d.rejected, medianDays: median(d.days) }))
      .sort((a, b) => b.approved + b.rejected - (a.approved + a.rejected)),
  };
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

/** When Card/Project.completedAt started being recorded on this server; earlier
 *  values were backfilled from the last edit, so the page flags them as estimates. */
async function completionTrackedSince(): Promise<Date | null> {
  const rows = await prisma.$queryRaw<{ finished_at: Date | null }[]>`
    SELECT finished_at FROM "_prisma_migrations" WHERE migration_name = '20261105090000_completed_at' LIMIT 1`;
  return rows[0]?.finished_at ?? null;
}

export async function loadDeliveryReport(workspaceId: string, since: Date, now: Date, rangeDays: number) {
  const topLevel = { columnId: { not: null }, column: { board: { workspaceId } } };
  const [completed, openCards, milestones, projects, who, trackedSince] = await Promise.all([
    prisma.card.findMany({
      where: { ...topLevel, completedAt: { gte: since } },
      select: { createdAt: true, completedAt: true, assignees: { select: { userId: true } } },
    }),
    prisma.card.findMany({
      where: { ...topLevel, completedAt: null },
      select: { dueDate: true, status: { select: { category: true } }, assignees: { select: { userId: true } } },
    }),
    prisma.milestone.findMany({
      where: { project: { workspaceId }, dueDate: { gte: since, lt: now } },
      orderBy: { dueDate: "asc" },
      select: { id: true, name: true, dueDate: true, completedAt: true, project: { select: { id: true, name: true } } },
    }),
    prisma.project.findMany({
      where: { workspaceId, completedAt: { gte: since } },
      orderBy: { completedAt: "desc" },
      select: { id: true, name: true, createdAt: true, completedAt: true },
    }),
    people(workspaceId),
    completionTrackedSince(),
  ]);

  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const isOverdue = (c: { dueDate: Date | null }) => !!c.dueDate && c.dueDate < startOfToday;

  type Row = { person: Person; done: number; cycle: number[]; inProgress: number; open: number; overdue: number };
  const rows = new Map<string, Row>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { person: who.get(id) ?? { id, name: "Former member" }, done: 0, cycle: [], inProgress: 0, open: 0, overdue: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const c of completed) {
    for (const a of c.assignees) {
      const r = row(a.userId);
      r.done++;
      r.cycle.push(days(c.createdAt, c.completedAt!));
    }
  }
  for (const c of openCards) {
    for (const a of c.assignees) {
      const r = row(a.userId);
      r.open++;
      if (c.status?.category === "active") r.inProgress++;
      if (isOverdue(c)) r.overdue++;
    }
  }

  // A milestone is on time if completed by the end of its due day (UTC).
  const dueEnd = (d: Date) => new Date(d.getTime() + DAY);
  const onTime = milestones.filter((m) => m.completedAt && m.completedAt < dueEnd(m.dueDate!)).length;
  const slipped = milestones
    .filter((m) => !m.completedAt || m.completedAt >= dueEnd(m.dueDate!))
    .map((m) => ({
      id: m.id,
      name: m.name,
      project: m.project,
      dueDate: m.dueDate!,
      completedAt: m.completedAt,
      daysLate: days(m.dueDate!, m.completedAt ?? now),
    }));

  return {
    completedCount: completed.length,
    medianCycleDays: median(completed.map((c) => days(c.createdAt, c.completedAt!))),
    inProgressCount: openCards.filter((c) => c.status?.category === "active").length,
    overdueCount: openCards.filter(isOverdue).length,
    perBucket: fill(makeBuckets(since, now, rangeDays), completed.map((c) => ({ at: c.completedAt! }))),
    people: [...rows.values()]
      .map((r) => ({ name: r.person.name, done: r.done, medianCycleDays: median(r.cycle), inProgress: r.inProgress, open: r.open, overdue: r.overdue }))
      .sort((a, b) => b.done - a.done || b.open - a.open),
    milestonesDue: milestones.length,
    milestonesOnTime: onTime,
    slipped,
    projectsCompleted: projects.map((p) => ({ id: p.id, name: p.name, completedAt: p.completedAt!, durationDays: days(p.createdAt, p.completedAt!) })),
    estimatedBefore: trackedSince && trackedSince > since ? trackedSince : null,
  };
}

// ─── Time ─────────────────────────────────────────────────────────────────────

export async function loadTimeReport(workspaceId: string, since: Date, now: Date, rangeDays: number) {
  const [entries, finished, who] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { project: { workspaceId }, loggedFor: { gte: since, lte: now } },
      select: { minutes: true, loggedFor: true, userId: true, project: { select: { id: true, name: true } } },
    }),
    // Estimating uses every finished deliverable that has time on it, regardless of
    // the window: the point is "what does a video usually take us", not "this quarter".
    prisma.deliverable.findMany({
      where: { project: { workspaceId }, status: "complete", timeEntries: { some: {} } },
      select: { type: true, timeEntries: { select: { minutes: true } } },
    }),
    people(workspaceId),
  ]);

  const sumBy = <K>(key: (e: (typeof entries)[number]) => K) => {
    const m = new Map<K, number>();
    for (const e of entries) m.set(key(e), (m.get(key(e)) ?? 0) + e.minutes);
    return m;
  };
  const byProject = sumBy((e) => e.project.id);
  const projectName = new Map(entries.map((e) => [e.project.id, e.project.name]));
  const byPerson = sumBy((e) => e.userId);

  const types = new Map<string, number[]>();
  for (const d of finished) {
    const hours = d.timeEntries.reduce((s, t) => s + t.minutes, 0) / 60;
    types.set(d.type, [...(types.get(d.type) ?? []), hours]);
  }

  return {
    totalHours: entries.reduce((s, e) => s + e.minutes, 0) / 60,
    entryCount: entries.length,
    perBucket: fill(makeBuckets(since, now, rangeDays), entries.map((e) => ({ at: e.loggedFor, amount: e.minutes / 60 }))),
    projects: [...byProject.entries()]
      .map(([id, min]) => ({ id, name: projectName.get(id) ?? "", hours: min / 60 }))
      .sort((a, b) => b.hours - a.hours),
    people: [...byPerson.entries()]
      .map(([id, min]) => ({ name: who.get(id)?.name ?? "Former member", hours: min / 60 }))
      .sort((a, b) => b.hours - a.hours),
    deliverableTypes: [...types.entries()]
      .map(([type, hours]) => ({
        type,
        label: DELIVERABLE_TYPE_LABEL[type as DeliverableType] ?? type,
        count: hours.length,
        medianHours: median(hours)!,
        avgHours: hours.reduce((s, h) => s + h, 0) / hours.length,
      }))
      .sort((a, b) => b.count - a.count),
  };
}
