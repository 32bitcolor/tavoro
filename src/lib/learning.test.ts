import { describe, expect, it } from "vitest";
import { liveFacts, liveLine, pct } from "./learning";
import type { LiveSummary } from "./courseforge";

const base: LiveSummary = { packages: 1, standards: ["scorm12"], version: 2, publishedAt: "2026-11-10T00:00:00Z", launches: 0, lastLaunchAt: null, results: null };

describe("liveFacts", () => {
  it("has no rates before anything reports", () => {
    const f = liveFacts({ ...base, launches: 3 });
    expect(f).toMatchObject({ launches: 3, reported: 0, finished: 0, finishRate: null, passRate: null, avgScore: null });
  });

  it("counts passed and completed as finished, and rates pass among graded only", () => {
    const f = liveFacts({ ...base, launches: 10, results: { sessions: 8, completed: 2, passed: 3, failed: 1, avgScore: 74, avgProgress: 0.7 } });
    expect(f.finished).toBe(5);
    expect(f.finishRate).toBeCloseTo(5 / 8);
    expect(f.passRate).toBeCloseTo(3 / 4);
    expect(f.avgScore).toBe(74);
  });

  it("has no pass rate for a course with no graded result", () => {
    expect(liveFacts({ ...base, launches: 2, results: { sessions: 2, completed: 2, passed: 0, failed: 0, avgScore: null, avgProgress: 1 } }).passRate).toBeNull();
  });
});

describe("liveLine", () => {
  it("reads naturally", () => {
    expect(liveLine({ ...base, launches: 1 })).toBe("1 launch");
    expect(liveLine({ ...base, launches: 10, results: { sessions: 8, completed: 2, passed: 3, failed: 1, avgScore: 74, avgProgress: 0.7 } })).toBe("10 launches · 5 of 8 finished · 75% passed · average score 74%");
  });
});

describe("pct", () => {
  it("rounds and dashes", () => {
    expect(pct(0.666)).toBe("67%");
    expect(pct(null)).toBe("—");
  });
});
