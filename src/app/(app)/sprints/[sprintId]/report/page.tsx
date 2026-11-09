import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { loadSprintReport, type ReportCard } from "@/lib/sprint-report";
import { formatEstimate } from "@/lib/card-fields";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { PriorityIcon, TypeIcon } from "@/components/shared/card-fields";
import { BurndownChart } from "@/components/reports/burndown-chart";
import { SetPageTitle } from "@/components/app-shell/breadcrumbs";

export const metadata = { title: "Sprint report · Tavoro" };

const TONE: Record<string, StatusTone> = { planned: "neutral", active: "info", completed: "success" };
const LABEL: Record<string, string> = { planned: "Planned", active: "Active", completed: "Completed" };
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function SprintReportPage({ params }: { params: Promise<{ sprintId: string }> }) {
  const { sprintId } = await params;
  const m = await getActiveMembership();
  if (!m) redirect("/login");
  const [r, ws] = await Promise.all([
    loadSprintReport(m.workspaceId, sprintId),
    prisma.workspace.findUnique({ where: { id: m.workspaceId }, select: { estimateUnit: true } }),
  ]);
  if (!r) notFound();
  const unit = ws?.estimateUnit === "hours" ? "hours" : "points";
  const est = (n: number) => formatEstimate(n, unit);
  const both = (cards: number, points: number) => `${cards} ${cards === 1 ? "card" : "cards"}${points ? ` · ${est(points)}` : ""}`;
  const today = new Date().toISOString().slice(0, 10);
  const s = r.sprint;

  const tiles: { label: string; value: string; hint?: string }[] = [];
  if (r.committed) tiles.push({ label: "Committed at the start", value: both(r.committed.cards, r.committed.points) });
  if (r.tally) {
    tiles.push({ label: s.status === "completed" ? "Completed" : "Done so far", value: both(r.tally.doneCards, r.tally.donePoints) });
    tiles.push({
      label: s.status === "completed" ? "Not done" : "Still to do",
      value: both(r.tally.notDoneCards, r.tally.notDonePoints),
      hint: s.status === "completed" && r.tally.notDoneCards ? `Moved to ${r.movedTo?.name ?? "the backlog"}` : undefined,
    });
  }
  if (r.addedAfterStart != null) tiles.push({ label: "Added after the start", value: String(r.addedAfterStart) });

  return (
    <PageContainer>
      <SetPageTitle title="Report" trail={[{ label: s.name, href: `/sprints/${s.id}` }]} />
      <PageHeader
        title={`${s.name} report`}
        description={s.goal ?? undefined}
        actions={
          <Link href={`/sprints/${s.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline">
            Sprint board <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        }
      />
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <StatusBadge tone={TONE[s.status] ?? "neutral"}>{LABEL[s.status] ?? s.status}</StatusBadge>
        {s.startDate && s.endDate && (
          <span>
            {fmtDay(s.startDate)} – {fmtDay(s.endDate)}
          </span>
        )}
        {s.completedAt && <span>· completed {fmtDay(s.completedAt.slice(0, 10))}</span>}
      </div>

      {tiles.length > 0 && (
        <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border border-border bg-surface p-3">
              <dt className="text-xs text-muted-foreground">{t.label}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{t.value}</dd>
              {t.hint && <dd className="text-xs text-muted-foreground">{t.hint}</dd>}
            </div>
          ))}
        </dl>
      )}

      <div className="mt-5">
        {r.burndown ? (
          <BurndownChart data={r.burndown} todayIso={today} />
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            {s.status === "planned" ? "The burndown starts when the sprint does." : "This sprint has no start and end dates, so there’s no burndown."}
          </p>
        )}
        {r.burndown && s.status !== "planned" && (
          <p className="mt-1.5 text-xs text-muted-foreground">Tavoro records each sprint&rsquo;s progress every night from the day it starts, so earlier days of older sprints have no points.</p>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <CardList title={s.status === "completed" ? "Completed" : "Done"} cards={r.done} added={r.addedIds} unit={unit} />
        <CardList title={s.status === "completed" ? "Not completed" : "Not done yet"} cards={r.notDone} added={r.addedIds} unit={unit} />
      </div>
      {r.hidden > 0 && <p className="mt-2 text-xs text-muted-foreground">{r.hidden} more {r.hidden === 1 ? "card is" : "cards are"} on boards you can&rsquo;t see, or no longer exist.</p>}
    </PageContainer>
  );
}

function CardList({ title, cards, added, unit }: { title: string; cards: ReportCard[]; added: string[]; unit: "points" | "hours" }) {
  const addedSet = new Set(added);
  const id = `list-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground">({cards.length})</span>
      </h2>
      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {cards.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <TypeIcon type={c.type} />
              {c.key && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.key}</span>}
              <Link href={`/boards/${c.boardId}?card=${c.id}`} className="min-w-0 flex-1 truncate hover:underline">
                {c.title}
              </Link>
              {addedSet.has(c.id) && <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">added</span>}
              {c.priority && <PriorityIcon priority={c.priority} />}
              {c.estimate != null && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatEstimate(c.estimate, unit)}</span>}
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{c.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
