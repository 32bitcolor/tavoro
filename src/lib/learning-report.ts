import "server-only";
import { prisma } from "@/lib/db";
import type { CourseSummary } from "@/lib/courseforge";
import { liveFacts, type LiveFacts } from "@/lib/learning";

// Reports → Learning (docs/SUITE.md, step 5): how the workspace's live courses are doing with
// learners, from the summaries cached on each card's course link (refreshed every 10 minutes).

export interface LearningRow extends LiveFacts {
  cardId: string;
  title: string;
  url: string;
  standards: string[];
  version: number;
  lastLaunchAt: Date | null;
  syncedAt: Date;
}

export interface LearningReport {
  rows: LearningRow[];
  totals: LiveFacts & { courses: number; withResults: number };
}

export async function loadLearningReport(
  workspaceId: string,
): Promise<LearningReport> {
  const links = await prisma.cardCourse.findMany({
    // A private card's course stays out of reports, like it stays out of the inventory.
    where: { missing: false, app: { workspaceId }, card: { private: false } },
    select: {
      cardId: true,
      title: true,
      summary: true,
      syncedAt: true,
      courseId: true,
      app: { select: { url: true } },
    },
    take: 2000,
  });
  const rows: LearningRow[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    const s = l.summary as unknown as CourseSummary | null;
    if (!s?.live || seen.has(l.courseId)) continue; // one course on two cards counts once
    seen.add(l.courseId);
    rows.push({
      ...liveFacts(s.live),
      cardId: l.cardId,
      title: l.title,
      url: s.url ?? `${l.app.url}/courses/${l.courseId}`,
      standards: s.live.standards,
      version: s.live.version,
      lastLaunchAt: s.live.lastLaunchAt ? new Date(s.live.lastLaunchAt) : null,
      syncedAt: l.syncedAt,
    });
  }
  rows.sort(
    (a, b) => b.launches - a.launches || a.title.localeCompare(b.title),
  );
  const sum = (k: "launches" | "reported" | "finished" | "passed" | "failed") =>
    rows.reduce((n, r) => n + r[k], 0);
  const reported = sum("reported");
  const graded = sum("passed") + sum("failed");
  const scored = rows.filter((r) => r.avgScore !== null && r.reported);
  const scoreWeight = scored.reduce((n, r) => n + r.reported, 0);
  return {
    rows,
    totals: {
      courses: rows.length,
      withResults: rows.filter((r) => r.reported).length,
      launches: sum("launches"),
      reported,
      finished: sum("finished"),
      passed: sum("passed"),
      failed: sum("failed"),
      finishRate: reported ? sum("finished") / reported : null,
      passRate: graded ? sum("passed") / graded : null,
      avgScore: scoreWeight
        ? Math.round(
            scored.reduce((n, r) => n + r.avgScore! * r.reported, 0) /
              scoreWeight,
          )
        : null,
    },
  };
}
