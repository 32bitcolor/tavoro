import { describe, expect, it } from "vitest";
import { burndown, velocity } from "./sprint-stats";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const snap = (day: string, scopePoints: number, donePoints: number) => ({ day: d(day), scopeCards: 5, scopePoints, doneCards: 1, donePoints });

describe("burndown", () => {
  it("draws remaining work per day, gaps where there's no snapshot, and the ideal line", () => {
    const b = burndown({
      startDate: d("2026-11-02"),
      endDate: d("2026-11-06"),
      status: "active",
      completedAt: null,
      report: { committed: { at: "", count: 4, estimate: 20, cardIds: [] } },
      days: [snap("2026-11-03", 20, 5)],
      live: { scopeCards: 5, scopePoints: 22, doneCards: 2, donePoints: 12 },
      now: d("2026-11-04"),
    })!;
    expect(b.unit).toBe("points");
    expect(b.days.map((x) => x.remaining)).toEqual([20, 15, 10, null, null]);
    expect(b.ideal.map((x) => x.value)).toEqual([20, 15, 10, 5, 0]);
    expect(b.days[2].scope).toBe(22); // scope grew mid-sprint
  });

  it("falls back to cards when nothing is estimated", () => {
    const b = burndown({
      startDate: d("2026-11-02"), endDate: d("2026-11-03"), status: "active", completedAt: null, report: {},
      days: [], live: { scopeCards: 3, scopePoints: 0, doneCards: 1, donePoints: 0 }, now: d("2026-11-02"),
    })!;
    expect(b.unit).toBe("cards");
    expect(b.days[0].remaining).toBe(2);
    expect(b.start).toBe(3);
  });

  it("puts a late completion on the last day, and needs dates", () => {
    const b = burndown({
      startDate: d("2026-11-02"), endDate: d("2026-11-03"), status: "completed", completedAt: d("2026-11-05"),
      report: {}, days: [snap("2026-11-05", 10, 8)], live: null, now: d("2026-11-09"),
    })!;
    expect(b.days.map((x) => x.remaining)).toEqual([null, 2]);
    expect(burndown({ startDate: null, endDate: null, status: "planned", completedAt: null, report: {}, days: [], live: null })).toBeNull();
  });
});

describe("velocity", () => {
  it("compares committed and completed, oldest first, averaging the last three", () => {
    const tally = (count: number, estimate: number) => ({ count, estimate, cardIds: [] });
    const v = velocity([
      { id: "b", name: "S2", completedAt: d("2026-10-20"), report: { committed: { at: "", count: 5, estimate: 20, cardIds: [] }, completed: { at: "", done: tally(4, 15), notDone: tally(2, 8), movedTo: null, addedAfterStart: 1 } } },
      { id: "a", name: "S1", completedAt: d("2026-10-06"), report: { completed: { at: "", done: tally(3, 10), notDone: tally(1, 3), movedTo: null, addedAfterStart: 0 } } },
      { id: "c", name: "S3", completedAt: null, report: {} },
    ]);
    expect(v.unit).toBe("points");
    expect(v.rows.map((r) => [r.name, r.committed, r.completed])).toEqual([["S1", 13, 10], ["S2", 20, 15]]);
    expect(v.average).toBe(12.5);
  });
});
