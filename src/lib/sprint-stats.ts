// Sprint numbers over time (docs/JIRA-PARITY.md, phase 6): the daily snapshots behind a
// burndown, and the burndown itself. Relative imports and no "server-only": the worker
// writes the nightly snapshots with its own Prisma client.
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type { SprintReport } from "./sprint";

type Db = PrismaClient | Prisma.TransactionClient;

export type Tally = { scopeCards: number; scopePoints: number; doneCards: number; donePoints: number };

const round = (n: number) => Math.round(n * 100) / 100;

/** What's in a sprint right now, across every board (epics aren't planned in sprints). */
export async function tallySprint(db: Db, sprintId: string): Promise<Tally> {
  const cards = await db.card.findMany({
    where: { sprintId, columnId: { not: null }, type: { not: "epic" } },
    select: { estimate: true, status: { select: { category: true } } },
  });
  const done = cards.filter((c) => c.status?.category === "done");
  return {
    scopeCards: cards.length,
    scopePoints: round(cards.reduce((n, c) => n + (c.estimate ?? 0), 0)),
    doneCards: done.length,
    donePoints: round(done.reduce((n, c) => n + (c.estimate ?? 0), 0)),
  };
}

/** Midnight UTC of a moment's day. */
export function utcDay(at: Date = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

export async function recordSprintDay(db: Db, sprintId: string, at: Date = new Date(), tally?: Tally) {
  const t = tally ?? (await tallySprint(db, sprintId));
  const day = utcDay(at);
  await db.sprintDay.upsert({ where: { sprintId_day: { sprintId, day } }, create: { sprintId, day, ...t }, update: t });
}

/** The nightly job: one snapshot per active sprint. */
export async function snapshotActiveSprints(db: PrismaClient): Promise<number> {
  const sprints = await db.sprint.findMany({ where: { status: "active" }, select: { id: true } });
  for (const s of sprints) await recordSprintDay(db, s.id);
  return sprints.length;
}

// ── Burndown (pure; unit-tested in sprint-stats.test.ts) ─────────────────────

export type BurnUnit = "points" | "cards";
export type BurnPoint = { day: string; remaining: number | null; scope: number | null; done: number | null };
export type Burndown = {
  unit: BurnUnit;
  days: BurnPoint[];
  /** The ideal line, from what the sprint started with down to zero on its last day. */
  ideal: { day: string; value: number }[];
  start: number | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function burndown(input: {
  startDate: Date | null;
  endDate: Date | null;
  status: string;
  completedAt: Date | null;
  report: SprintReport;
  days: { day: Date; scopeCards: number; scopePoints: number; doneCards: number; donePoints: number }[];
  /** Today's live tally (active sprints). */
  live: Tally | null;
  now?: Date;
}): Burndown | null {
  if (!input.startDate || !input.endDate) return null;
  const start = utcDay(input.startDate);
  const end = utcDay(input.endDate);
  if (end < start) return null;
  const now = utcDay(input.now ?? new Date());
  const last = input.status === "completed" && input.completedAt ? utcDay(input.completedAt) : now;
  const committed = input.report.committed;

  const snaps = new Map(input.days.map((d) => [iso(utcDay(d.day)), d as Tally]));
  if (input.live && input.status === "active") snaps.set(iso(now), input.live);
  const anyPoints = (committed?.estimate ?? 0) > 0 || [...snaps.values()].some((t) => t.scopePoints > 0);
  const unit: BurnUnit = anyPoints ? "points" : "cards";
  const pick = (t: Tally) => (unit === "points" ? { scope: t.scopePoints, done: t.donePoints } : { scope: t.scopeCards, done: t.doneCards });

  const days: BurnPoint[] = [];
  const stop = last < end ? last : end;
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const key = iso(d);
    const snap = snaps.get(key);
    if (d > stop && d > now) {
      days.push({ day: key, remaining: null, scope: null, done: null });
      continue;
    }
    if (snap) {
      const v = pick(snap);
      days.push({ day: key, remaining: round(v.scope - v.done), scope: v.scope, done: v.done });
    } else if (key === iso(start) && committed) {
      const scope = unit === "points" ? committed.estimate : committed.count;
      days.push({ day: key, remaining: scope, scope, done: 0 });
    } else days.push({ day: key, remaining: null, scope: null, done: null });
  }
  // A sprint completed after its end date: its last snapshot belongs on the last day.
  if (last > end) {
    const snap = snaps.get(iso(last));
    if (snap) {
      const v = pick(snap);
      days[days.length - 1] = { day: iso(end), remaining: round(v.scope - v.done), scope: v.scope, done: v.done };
    }
  }

  const startValue = committed ? (unit === "points" ? committed.estimate : committed.count) : (days.find((d) => d.scope != null)?.scope ?? null);
  const n = days.length - 1;
  const ideal = startValue == null ? [] : days.map((d, i) => ({ day: d.day, value: round(n === 0 ? 0 : startValue * (1 - i / n)) }));
  return { unit, days, ideal, start: startValue };
}

// ── Velocity ─────────────────────────────────────────────────────────────────

export type VelocityRow = { id: string; name: string; completedAt: string; committed: number; completed: number };

/** Committed vs. completed per completed sprint, oldest first, from Sprint.report. */
export function velocity(sprints: { id: string; name: string; completedAt: Date | null; report: SprintReport }[]): { unit: BurnUnit; rows: VelocityRow[]; average: number | null } {
  const done = sprints.filter((s) => s.report.completed && s.completedAt);
  const anyPoints = done.some((s) => (s.report.completed!.done.estimate + s.report.completed!.notDone.estimate) > 0 || (s.report.committed?.estimate ?? 0) > 0);
  const unit: BurnUnit = anyPoints ? "points" : "cards";
  const rows = done
    .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime())
    .map((s) => {
      const c = s.report.completed!;
      const committed = s.report.committed
        ? unit === "points" ? s.report.committed.estimate : s.report.committed.count
        : unit === "points" ? c.done.estimate + c.notDone.estimate : c.done.count + c.notDone.count;
      return { id: s.id, name: s.name, completedAt: s.completedAt!.toISOString(), committed: round(committed), completed: round(unit === "points" ? c.done.estimate : c.done.count) };
    });
  const recent = rows.slice(-3);
  return { unit, rows, average: recent.length ? round(recent.reduce((n, r) => n + r.completed, 0) / recent.length) : null };
}
