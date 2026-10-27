import Link from "next/link";
import { redirect } from "next/navigation";
import { ChartColumn } from "lucide-react";

import { getActiveMembership } from "@/lib/dal";
import { Role } from "@/generated/prisma/client";
import { INTAKE_STATUS_LABEL, type IntakeStatus } from "@/lib/intake";
import {
  REPORT_RANGES,
  loadDeliveryReport,
  loadIntakeReport,
  loadTimeReport,
  parseRange,
  type Bucket,
  type ReportRange,
} from "@/lib/reports";
import { cn } from "@/lib/utils";
import { PageContainer, PageHeader, SectionHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { ColumnChart, type ChartBucket } from "@/components/reports/column-chart";

export const metadata = { title: "Reports · Tavoro" };

const TABS = [
  { key: "intake", label: "Intake" },
  { key: "delivery", label: "Delivery" },
  { key: "time", label: "Time" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const RANGE_LABEL: Record<ReportRange, string> = { 30: "30 days", 90: "90 days", 180: "6 months", 365: "12 months" };

// Kept out of the component body (react-hooks/purity flags Date.now() there).
function reportWindow(range: ReportRange) {
  const now = new Date();
  return { now, since: new Date(now.getTime() - range * 86_400_000) };
}

const dateFmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** `estimatedBefore`: buckets reaching back before this date hold backfilled
 *  (estimated) values, and the chart draws them muted. */
function chartBuckets(buckets: Bucket[], now: Date, estimatedBefore?: Date | null): ChartBucket[] {
  return buckets.map((b) => {
    // Label the bucket by its last day, or today for the bucket still in progress.
    const last = new Date(Math.min(b.end.getTime() - 86_400_000, now.getTime()));
    const range = b.start.getTime() >= last.getTime() ? dateFmt(b.start) : `${dateFmt(b.start)} – ${dateFmt(last)}`;
    return { label: b.label, range, value: Math.round(b.value * 10) / 10, estimated: !!estimatedBefore && b.start < estimatedBefore };
  });
}

function fmtDays(n: number | null) {
  if (n === null) return "—";
  if (n < 1) return "< 1 day";
  const v = n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return `${v} ${v === 1 ? "day" : "days"}`;
}
const fmtHours = (h: number) => `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} h`;
const fmtPct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; range?: string }> }) {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  if (membership.role !== Role.ADMIN && membership.role !== Role.MANAGER) redirect("/dashboard");

  const params = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === params.tab) ? (params.tab as Tab) : "intake";
  const range = parseRange(params.range);
  const { now, since } = reportWindow(range);
  const ws = membership.workspaceId;
  const href = (t: Tab, r: ReportRange) => `/reports?tab=${t}&range=${r}`;

  return (
    <PageContainer>
      <PageHeader title="Reports" description="How work is flowing through the team. Visible to admins and managers." />

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Report" className="flex rounded-md bg-muted p-0.5">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={href(t.key, range)}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "inline-flex h-7 items-center rounded px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                tab === t.key ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Time range" className="flex rounded-md bg-muted p-0.5">
          {REPORT_RANGES.map((r) => (
            <Link
              key={r}
              href={href(tab, r)}
              aria-current={range === r ? "page" : undefined}
              className={cn(
                "inline-flex h-7 items-center rounded px-2.5 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                range === r ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {RANGE_LABEL[r]}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {tab === "intake" && <IntakeTab ws={ws} since={since} now={now} range={range} />}
        {tab === "delivery" && <DeliveryTab ws={ws} since={since} now={now} range={range} />}
        {tab === "time" && <TimeTab ws={ws} since={since} now={now} range={range} />}
      </div>
    </PageContainer>
  );
}

type TabProps = { ws: string; since: Date; now: Date; range: ReportRange };

function Stats({ items }: { items: { label: string; value: string; hint?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 [&>*]:min-w-0">
      {items.map((s) => (
        <div key={s.label} className="rounded-lg border border-border bg-surface p-4">
          <dt className="text-xs text-muted-foreground">{s.label}</dt>
          <dd className="mt-1 text-2xl font-semibold">{s.value}</dd>
          {s.hint ? <dd className="mt-0.5 text-xs text-muted-foreground">{s.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** A plain bordered table that scrolls sideways on narrow screens instead of the page. */
function Table({ head, rows, empty }: { head: { label: string; num?: boolean }[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {head.map((h) => (
              <th key={h.label} className={cn("whitespace-nowrap px-3 py-2 font-medium", h.num ? "text-right" : "text-left")}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={cn("px-3 py-2", head[j]?.num ? "text-right tabular-nums whitespace-nowrap" : "")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function IntakeTab({ ws, since, now, range }: TabProps) {
  const r = await loadIntakeReport(ws, since, now, range);
  return (
    <div className="flex flex-col gap-6">
      <Stats
        items={[
          { label: "Requests submitted", value: String(r.submittedCount), hint: `last ${RANGE_LABEL[range]}` },
          { label: "Time to decision", value: fmtDays(r.medianDaysToDecision), hint: `median of ${r.decidedCount} decided` },
          { label: "Approval rate", value: fmtPct(r.approvalRate), hint: "approved ÷ decided" },
          { label: "Waiting now", value: String(r.openCount), hint: "submitted, triaging or needs info" },
        ]}
      />
      <ColumnChart title="Requests submitted" buckets={chartBuckets(r.perBucket, now)} unit="requests" />
      <section>
        <SectionHeader>Waiting for a decision</SectionHeader>
        <Table
          head={[{ label: "Request" }, { label: "Status" }, { label: "Assigned to" }, { label: "Waiting", num: true }]}
          empty="Nothing is waiting — every request has a decision."
          rows={r.waiting.map((w) => [
            <Link key="t" href={`/intake/${w.id}`} className="hover:underline">
              <span className="text-muted-foreground">REQ-{w.number}</span> {w.title}
            </Link>,
            INTAKE_STATUS_LABEL[w.status as IntakeStatus] ?? w.status,
            w.assignee ?? <span className="text-muted-foreground">Unassigned</span>,
            fmtDays(w.ageDays),
          ])}
        />
      </section>
      <section>
        <SectionHeader>Decisions by person</SectionHeader>
        <Table
          head={[{ label: "Person" }, { label: "Approved", num: true }, { label: "Rejected", num: true }, { label: "Median time to decision", num: true }]}
          empty={`No requests were decided in the last ${RANGE_LABEL[range]}.`}
          rows={r.deciders.map((d) => [d.name, d.approved, d.rejected, fmtDays(d.medianDays)])}
        />
      </section>
    </div>
  );
}

async function DeliveryTab({ ws, since, now, range }: TabProps) {
  const r = await loadDeliveryReport(ws, since, now, range);
  return (
    <div className="flex flex-col gap-6">
      <Stats
        items={[
          { label: "Cards completed", value: String(r.completedCount), hint: `last ${RANGE_LABEL[range]}` },
          { label: "Cycle time", value: fmtDays(r.medianCycleDays), hint: "median, created → done" },
          { label: "Milestones on time", value: r.milestonesDue ? fmtPct(r.milestonesOnTime / r.milestonesDue) : "—", hint: `${r.milestonesOnTime} of ${r.milestonesDue} due` },
          { label: "Overdue cards", value: String(r.overdueCount), hint: `${r.inProgressCount} in progress now` },
        ]}
      />
      <ColumnChart title="Cards completed" buckets={chartBuckets(r.perBucket, now, r.estimatedBefore)} unit="cards" />
      {r.estimatedBefore ? (
        <p className="-mt-3 text-xs text-muted-foreground">
          Faded bars include completion dates estimated from each card&apos;s last edit — Tavoro started recording them on {dateFmt(r.estimatedBefore)}.
        </p>
      ) : null}
      <section>
        <SectionHeader>By person</SectionHeader>
        <Table
          head={[
            { label: "Person" },
            { label: "Completed", num: true },
            { label: "Median cycle time", num: true },
            { label: "In progress", num: true },
            { label: "Open", num: true },
            { label: "Overdue", num: true },
          ]}
          empty="No assigned cards yet."
          rows={r.people.map((p) => [p.name, p.done, fmtDays(p.medianCycleDays), p.inProgress, p.open, p.overdue])}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Cards with several assignees count for each of them. For each person&apos;s open cards, see{" "}
          <Link href="/team" className="text-link">Team</Link>.
        </p>
      </section>
      <section>
        <SectionHeader>Milestones that slipped</SectionHeader>
        <Table
          head={[{ label: "Milestone" }, { label: "Project" }, { label: "Due", num: true }, { label: "Outcome", num: true }]}
          empty={r.milestonesDue ? "Every milestone due in this period was met on time." : `No milestones were due in the last ${RANGE_LABEL[range]}.`}
          rows={r.slipped.map((m) => [
            m.name,
            <Link key="p" href={`/projects/${m.project.id}`} className="hover:underline">{m.project.name}</Link>,
            dateFmt(m.dueDate),
            m.completedAt ? `Done ${fmtDays(m.daysLate)} late` : `Not done · ${fmtDays(m.daysLate)} overdue`,
          ])}
        />
      </section>
      <section>
        <SectionHeader>Projects completed</SectionHeader>
        <Table
          head={[{ label: "Project" }, { label: "Completed", num: true }, { label: "Duration", num: true }]}
          empty={`No projects were completed in the last ${RANGE_LABEL[range]}.`}
          rows={r.projectsCompleted.map((p) => [
            <Link key="p" href={`/projects/${p.id}`} className="hover:underline">{p.name}</Link>,
            dateFmt(p.completedAt),
            fmtDays(p.durationDays),
          ])}
        />
      </section>
    </div>
  );
}

async function TimeTab({ ws, since, now, range }: TabProps) {
  const r = await loadTimeReport(ws, since, now, range);
  if (r.entryCount === 0 && r.deliverableTypes.length === 0) {
    return (
      <EmptyState
        icon={ChartColumn}
        title="No time logged yet"
        description="These numbers appear once people log time in a project's Time tracking section. Logging against a deliverable also builds up how long each kind of deliverable usually takes."
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Stats
        items={[
          { label: "Hours logged", value: fmtHours(r.totalHours), hint: `last ${RANGE_LABEL[range]}` },
          { label: "Projects with time", value: String(r.projects.length) },
          { label: "People logging", value: String(r.people.length) },
          { label: "Entries", value: String(r.entryCount) },
        ]}
      />
      <ColumnChart title="Hours logged" buckets={chartBuckets(r.perBucket, now)} unit="hours" decimals={1} />
      <div className="grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
        <section>
          <SectionHeader>By project</SectionHeader>
          <Table
            head={[{ label: "Project" }, { label: "Hours", num: true }]}
            empty="No time logged in this period."
            rows={r.projects.map((p) => [
              <Link key="p" href={`/projects/${p.id}`} className="hover:underline">{p.name}</Link>,
              fmtHours(p.hours),
            ])}
          />
        </section>
        <section>
          <SectionHeader>By person</SectionHeader>
          <Table head={[{ label: "Person" }, { label: "Hours", num: true }]} empty="No time logged in this period." rows={r.people.map((p) => [p.name, fmtHours(p.hours)])} />
        </section>
      </div>
      <section>
        <SectionHeader>Typical effort by deliverable type</SectionHeader>
        <Table
          head={[{ label: "Type" }, { label: "Finished", num: true }, { label: "Median", num: true }, { label: "Average", num: true }]}
          empty="No finished deliverables have time logged against them yet."
          rows={r.deliverableTypes.map((d) => [d.label, d.count, fmtHours(d.medianHours), fmtHours(d.avgHours)])}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          All finished deliverables with time logged against them, not just this period — use it when estimating new work.
        </p>
      </section>
    </div>
  );
}
