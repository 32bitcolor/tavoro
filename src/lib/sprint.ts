// Sprint vocabulary. Lives in a plain module (not the "use server" actions file)
// because a "use server" file may only export async functions.
export const SPRINT_STATUSES = ["planned", "active", "completed"] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];

export const SPRINT_STATUS_LABEL: Record<SprintStatus, string> = {
  planned: "Planned",
  active: "Active",
  completed: "Completed",
};

/** What a sprint started and finished with, kept on Sprint.report for reports later.
 *  `committed` is written when the sprint starts, `completed` when it's completed. */
export type SprintTally = { count: number; estimate: number; cardIds: string[] };
export type SprintReport = {
  committed?: SprintTally & { at: string };
  completed?: {
    at: string;
    done: SprintTally;
    notDone: SprintTally;
    /** Where the unfinished cards went; null = the backlog. */
    movedTo: { id: string; name: string } | null;
    /** Cards finished in the sprint that weren't in it when it started. */
    addedAfterStart: number;
  };
};

export function asSprintReport(v: unknown): SprintReport {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as SprintReport) : {};
}

/** "Sprint 12" → "Sprint 13"; "Launch" → "Launch 2". */
export function nextSprintName(name: string): string {
  const m = /^(.*?)(\d+)\s*$/.exec(name.trim());
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${name.trim()} 2`;
}

/** "8 of 10 cards done" plus points, for a completed sprint's one-line summary. */
export function sprintReportLine(r: SprintReport, fmt: (n: number) => string): string | null {
  const c = r.completed;
  if (!c) return null;
  const total = c.done.count + c.notDone.count;
  const est = c.done.estimate + c.notDone.estimate;
  return `${c.done.count} of ${total} ${total === 1 ? "card" : "cards"} done${est ? ` · ${Math.round(c.done.estimate * 100) / 100} of ${fmt(est)}` : ""}`;
}
