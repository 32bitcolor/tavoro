// Learner results for a course's live LMS packages (docs/SUITE.md, step 5): the numbers
// CourseForge's players report, anonymously, and how Tavoro words them.
import type { LiveSummary } from "./courseforge";

export const STANDARD_LABEL: Record<string, string> = {
  scorm12: "SCORM 1.2",
  scorm2004: "SCORM 2004",
  xapi: "xAPI",
  cmi5: "cmi5",
};

export interface LiveFacts {
  launches: number;
  /** Launches whose player has reported at all. */
  reported: number;
  finished: number;
  passed: number;
  failed: number;
  /** finished / reported, 0..1; null before any report. */
  finishRate: number | null;
  /** passed / (passed + failed), 0..1; null when the course has no pass/fail result. */
  passRate: number | null;
  avgScore: number | null;
}

export function liveFacts(l: LiveSummary): LiveFacts {
  const r = l.results;
  const finished = r ? r.completed + r.passed + r.failed : 0;
  const graded = r ? r.passed + r.failed : 0;
  return {
    launches: l.launches,
    reported: r?.sessions ?? 0,
    finished,
    passed: r?.passed ?? 0,
    failed: r?.failed ?? 0,
    finishRate: r && r.sessions ? finished / r.sessions : null,
    passRate: r && graded ? r.passed / graded : null,
    avgScore: r?.avgScore ?? null,
  };
}

export const pct = (n: number | null) =>
  n === null ? "—" : `${Math.round(n * 100)}%`;

/** One line for a card or content page: "3 launches · 2 of 3 finished · 67% passed · average score 82%". */
export function liveLine(l: LiveSummary): string {
  const f = liveFacts(l);
  const parts = [`${f.launches} launch${f.launches === 1 ? "" : "es"}`];
  if (f.reported) parts.push(`${f.finished} of ${f.reported} finished`);
  if (f.passRate !== null) parts.push(`${pct(f.passRate)} passed`);
  if (f.avgScore !== null) parts.push(`average score ${f.avgScore}%`);
  return parts.join(" · ");
}
