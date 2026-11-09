"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, FolderKanban, X, Zap } from "lucide-react";

import { setCardDates } from "@/app/actions/cards";
import { setCardStatus } from "@/app/actions/boards";
import { CardDrawer } from "@/components/board/card-drawer";
import { useSetPageTitle } from "@/components/app-shell/breadcrumbs";
import { SingleSelectChip } from "@/components/sprint/sprint-board";
import { PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import type { RoadmapEpic } from "@/lib/roadmap";
import { cn } from "@/lib/utils";

// The roadmap (docs/JIRA-PARITY.md, phase 6): open epics as bars from start to due date,
// filled by how many of their cards are done. Drag a bar to move it, or its ends to
// change one date; or open the epic and set the dates there (the non-drag path).

const DAY = 86_400_000;
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const monthStart = (t: number) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};
const addMonths = (t: number, n: number) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
};
const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

type Zoom = "months" | "quarters";
const DAY_PX: Record<Zoom, number> = { months: 5, quarters: 1.6 };

type Drag = { id: string; mode: "move" | "start" | "end"; x0: number; delta: number };

export function RoadmapView({ initial, today, statuses }: { initial: RoadmapEpic[]; today: string; statuses: { id: string; name: string }[] }) {
  const router = useRouter();
  const [epics, setEpics] = useState(initial);
  const [zoom, setZoom] = useState<Zoom>("months");
  const [board, setBoard] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const px = DAY_PX[zoom];
  useSetPageTitle("Roadmap");

  const boards = useMemo(() => {
    const m = new Map<string, string>();
    epics.forEach((e) => m.set(e.boardId, e.boardName));
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [epics]);
  const shown = epics.filter((e) => (showDone || !e.done) && (!board || e.boardId === board));
  const dated = shown.filter((e) => e.startDate || e.dueDate);
  const undated = shown.filter((e) => !e.startDate && !e.dueDate);

  // The window: a little before today (or the earliest epic) to a quarter past today (or the latest).
  const todayT = parse(today);
  const times = dated.flatMap((e) => [e.startDate, e.dueDate].filter((x): x is string => !!x).map(parse));
  const from = monthStart(Math.min(todayT - 14 * DAY, ...times));
  const to = addMonths(monthStart(Math.max(todayT + 90 * DAY, ...times)), 1);
  const width = Math.round(((to - from) / DAY) * px);
  const x = (t: number) => ((t - from) / DAY) * px;

  const ticks: { t: number; label: string; major: boolean }[] = [];
  for (let t = from; t < to; t = addMonths(t, 1)) {
    const d = new Date(t);
    const m = d.getUTCMonth();
    if (zoom === "months") ticks.push({ t, label: d.toLocaleDateString(undefined, { month: "short", year: m === 0 || t === from ? "numeric" : undefined, timeZone: "UTC" }), major: m === 0 });
    else if (m % 3 === 0 || t === from) ticks.push({ t, label: `Q${Math.floor(m / 3) + 1} ${d.getUTCFullYear()}`, major: true });
  }

  // Start with today in view.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, x(todayT) - 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  function datesDuring(e: RoadmapEpic): { start: string | null; due: string | null } {
    if (!drag || drag.id !== e.id || drag.delta === 0) return { start: e.startDate, due: e.dueDate };
    const shift = (s: string | null) => (s ? iso(parse(s) + drag.delta * DAY) : s);
    if (drag.mode === "move") return { start: shift(e.startDate), due: shift(e.dueDate) };
    if (drag.mode === "start") {
      const s = shift(e.startDate ?? e.dueDate);
      return { start: e.dueDate && s! > e.dueDate ? e.dueDate : s, due: e.dueDate };
    }
    const d = shift(e.dueDate ?? e.startDate);
    return { start: e.startDate, due: e.startDate && d! < e.startDate ? e.startDate : d };
  }

  function onPointerDown(ev: React.PointerEvent, e: RoadmapEpic, mode: Drag["mode"]) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    setDrag({ id: e.id, mode, x0: ev.clientX, delta: 0 });
    setNotice(null);
  }

  function onPointerMove(ev: React.PointerEvent) {
    if (!drag) return;
    const delta = Math.round((ev.clientX - drag.x0) / px);
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  }

  async function onPointerUp(e: RoadmapEpic) {
    if (!drag) return;
    const d = drag;
    const next = datesDuring(e);
    setDrag(null);
    if (d.delta === 0) {
      if (d.mode === "move") setOpenId(e.id); // a click, not a drag
      return;
    }
    setEpics((list) => list.map((x) => (x.id === e.id ? { ...x, startDate: next.start, dueDate: next.due } : x)));
    const res = await setCardDates(e.id, next.start ? `${next.start}T00:00:00.000Z` : null, next.due ? `${next.due}T00:00:00.000Z` : null);
    if (res && "error" in res && res.error) {
      setEpics((list) => list.map((x) => (x.id === e.id ? e : x)));
      setNotice(res.error);
    }
  }

  return (
    <div className="flex min-h-screen min-w-0 flex-col gap-4 px-4 pt-5 pb-10 sm:px-6">
      <PageHeader title="Roadmap" description="Epics across every board, from start to due date. Drag a bar to move it, or its ends to change a date." />
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Zoom" className="flex rounded-md bg-muted p-0.5">
          {(["months", "quarters"] as const).map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={zoom === z}
              onClick={() => setZoom(z)}
              className={cn("h-7 rounded px-2.5 text-xs font-medium capitalize", zoom === z ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
            >
              {z}
            </button>
          ))}
        </nav>
        <SingleSelectChip icon={<FolderKanban className="size-3.5" />} label="Board" value={board} current={board ? boards.find((b) => b.id === board)?.name ?? null : null} options={boards} onChange={setBoard} />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Show done epics
        </label>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => scroller.current && (scroller.current.scrollLeft = Math.max(0, x(todayT) - 120))}>
          <CalendarClock className="size-3.5" aria-hidden="true" />
          Today
        </Button>
      </div>
      {notice && (
        <p role="alert" className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-ink">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </p>
      )}

      {dated.length === 0 && undated.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          No {showDone ? "" : "open "}epics yet. Make a card an epic (its Type field) to plan it here.
        </p>
      ) : (
        <div ref={scroller} className="relative overflow-x-auto rounded-lg border border-border bg-surface" role="region" aria-label="Timeline" tabIndex={0}>
          <div style={{ width: width + 224 }} className="relative">
            {/* Header */}
            <div className="sticky top-0 z-20 flex border-b border-border bg-surface-muted text-xs text-muted-foreground">
              <div className="sticky left-0 z-30 w-56 shrink-0 border-r border-border bg-surface-muted px-3 py-2 font-medium">Epic</div>
              <div className="relative h-8" style={{ width }}>
                {ticks.map((t) => (
                  <span key={t.t} className={cn("absolute top-2 pl-1.5 whitespace-nowrap", t.major && "font-medium text-foreground")} style={{ left: x(t.t) }}>
                    {t.label}
                  </span>
                ))}
                <span className="absolute top-0 bottom-0 w-px bg-accent" style={{ left: x(todayT) }} aria-hidden="true" />
              </div>
            </div>
            {/* Rows */}
            {dated.map((e) => {
              const { start, due } = datesDuring(e);
              const s = start ? parse(start) : null;
              const d = due ? parse(due) : null;
              const left = x(s ?? d!);
              const right = d != null ? x(d) + px : x(s!) + 14 * px;
              const pct = e.progress.total ? e.progress.done / e.progress.total : 0;
              const label = `${e.key ? `${e.key} ` : ""}${e.title}: ${start ? fmt(start) : "no start"} – ${due ? fmt(due) : "no due date"}, ${e.progress.done} of ${e.progress.total} cards done`;
              return (
                <div key={e.id} className="group flex border-b border-border last:border-b-0">
                  <div className="sticky left-0 z-10 flex w-56 shrink-0 flex-col justify-center border-r border-border bg-surface px-3 py-1.5">
                    <button type="button" onClick={() => setOpenId(e.id)} className="flex min-w-0 items-center gap-1.5 text-left text-sm hover:underline">
                      <Zap className="size-3.5 shrink-0 text-epic-ink" aria-hidden="true" />
                      {e.key && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{e.key}</span>}
                      <span className={cn("truncate", e.done && "text-muted-foreground line-through")}>{e.title}</span>
                    </button>
                    <span className="pl-5 text-[11px] text-muted-foreground">
                      {e.progress.done}/{e.progress.total} done · {e.boardName}
                    </span>
                  </div>
                  <div className="relative h-12" style={{ width }}>
                    {ticks.map((t) => (
                      <span key={t.t} className="absolute top-0 bottom-0 w-px bg-border/60" style={{ left: x(t.t) }} aria-hidden="true" />
                    ))}
                    <span className="absolute top-0 bottom-0 w-px bg-accent/50" style={{ left: x(todayT) }} aria-hidden="true" />
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={label}
                      title={label}
                      onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), setOpenId(e.id))}
                      onPointerDown={(ev) => onPointerDown(ev, e, "move")}
                      onPointerMove={onPointerMove}
                      onPointerUp={() => onPointerUp(e)}
                      className={cn(
                        "absolute top-3 flex h-6 touch-none items-center overflow-hidden rounded-md border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        drag?.id === e.id ? "cursor-grabbing" : "cursor-grab",
                        e.done ? "border-border-strong bg-muted" : "border-accent bg-accent/15",
                        d == null && "border-dashed",
                        s == null && "rounded-l-none border-l-[3px]",
                      )}
                      style={{ left, width: Math.max(10, right - left) }}
                    >
                      <span className={cn("absolute inset-y-0 left-0", e.done ? "bg-border-strong" : "bg-accent")} style={{ width: `${pct * 100}%` }} aria-hidden="true" />
                      {s != null && (
                        <span
                          onPointerDown={(ev) => onPointerDown(ev, e, "start")}
                          onPointerMove={onPointerMove}
                          onPointerUp={() => onPointerUp(e)}
                          className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize"
                          aria-hidden="true"
                        />
                      )}
                      {d != null && (
                        <span
                          onPointerDown={(ev) => onPointerDown(ev, e, "end")}
                          onPointerMove={onPointerMove}
                          onPointerUp={() => onPointerUp(e)}
                          className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    {drag?.id === e.id && drag.delta !== 0 && (
                      <span className="pointer-events-none absolute top-0 z-20 rounded border border-border bg-popover px-1.5 text-[11px] whitespace-nowrap text-popover-foreground shadow-sm" style={{ left }}>
                        {start ? fmt(start) : "—"} – {due ? fmt(due) : "—"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {undated.length > 0 && (
        <section aria-labelledby="undated">
          <h2 id="undated" className="mb-2 text-sm font-semibold">
            No dates yet <span className="font-normal text-muted-foreground">({undated.length})</span>
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {undated.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setOpenId(e.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover">
                  <Zap className="size-3.5 shrink-0 text-epic-ink" aria-hidden="true" />
                  {e.key && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{e.key}</span>}
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">Set dates</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {openId && (
        <CardDrawer
          cardId={openId}
          onClose={() => {
            setOpenId(null);
            router.refresh();
          }}
          onPatch={(id, p) => {
            if (p.title !== undefined) setEpics((l) => l.map((x) => (x.id === id ? { ...x, title: p.title! } : x)));
            if (p.dueDate !== undefined) setEpics((l) => l.map((x) => (x.id === id ? { ...x, dueDate: p.dueDate ? p.dueDate.slice(0, 10) : null } : x)));
            if (p.type !== undefined && p.type !== "epic") setEpics((l) => l.filter((x) => x.id !== id));
          }}
          onDeleted={(id) => {
            setEpics((l) => l.filter((x) => x.id !== id));
            setOpenId(null);
          }}
          onNavigate={(id) => setOpenId(id)}
          columns={statuses}
          onMoveToColumn={(statusId) => openId && setCardStatus(openId, statusId).then(() => router.refresh())}
        />
      )}
    </div>
  );
}
