"use client";

import * as React from "react";

import type { Burndown } from "@/lib/sprint-stats";

// Sprint burndown: remaining work per day (accent line, 2px, 8px markers with a surface
// ring) against the ideal line (dashed, recessive --chart-ref). Days with no snapshot
// break the line instead of inventing values. Hover or focus a day for its numbers;
// every value is also in the table view.

const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });

function niceTop(max: number) {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step * 0.001; t += step) ticks.push(Math.round(t * 100) / 100);
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 100) / 100);
  return { top: ticks[ticks.length - 1], ticks };
}

function useWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [w, setW] = React.useState(600);
  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function BurndownChart({ data, todayIso }: { data: Burndown; todayIso: string }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = React.useState<number | null>(null);
  const unit = data.unit === "points" ? "pts" : "cards";
  const H = 200;
  const pad = { l: 36, r: 56, t: 10, b: 24 };
  const iw = width - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = Math.max(data.start ?? 0, ...data.days.map((d) => Math.max(d.remaining ?? 0, d.scope ?? 0)));
  const { top, ticks } = niceTop(max);
  const n = Math.max(1, data.days.length - 1);
  const x = (i: number) => pad.l + (i / n) * iw;
  const y = (v: number) => pad.t + ih - (v / top) * ih;

  // Remaining: segments between consecutive known days.
  const segments: string[] = [];
  let cur: string[] = [];
  data.days.forEach((d, i) => {
    if (d.remaining == null) {
      if (cur.length > 1) segments.push(cur.join(" "));
      cur = [];
      return;
    }
    cur.push(`${x(i)},${y(d.remaining)}`);
  });
  if (cur.length > 1) segments.push(cur.join(" "));
  const idealPts = data.ideal.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const lastKnown = [...data.days.keys()].reverse().find((i) => data.days[i].remaining != null);
  const todayIdx = data.days.findIndex((d) => d.day === todayIso);
  const every = Math.max(1, Math.ceil(data.days.length / Math.max(2, Math.floor(iw / 64))));

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * n);
    setActive(Math.min(data.days.length - 1, Math.max(0, i)));
  }

  const a = active != null ? data.days[active] : null;
  return (
    <figure className="rounded-lg border border-border bg-surface p-4">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">Burndown</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <svg width="18" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="18" y2="4" stroke="var(--accent)" strokeWidth="2" />
          </svg>
          Remaining ({unit})
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <svg width="18" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="18" y2="4" stroke="var(--chart-ref)" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          Ideal
        </span>
      </figcaption>
      <div ref={wrap} className="relative">
        <svg width={width} height={H} role="img" aria-label={`Burndown: ${data.days.filter((d) => d.remaining != null).map((d) => `${fmtDay(d.day)} ${d.remaining} ${unit}`).join(", ")}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {t}
              </text>
            </g>
          ))}
          {data.days.map((d, i) =>
            i % every === 0 || i === data.days.length - 1 ? (
              <text key={d.day} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {fmtDay(d.day)}
              </text>
            ) : null,
          )}
          {todayIdx > 0 && todayIdx < data.days.length - 1 && (
            <g>
              <line x1={x(todayIdx)} x2={x(todayIdx)} y1={pad.t} y2={pad.t + ih} stroke="var(--border-strong)" strokeWidth="1" />
              <text x={x(todayIdx) + 4} y={pad.t + 10} className="fill-muted-foreground text-[11px]">
                Today
              </text>
            </g>
          )}
          {idealPts && <polyline points={idealPts} fill="none" stroke="var(--chart-ref)" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" />}
          {segments.map((p, i) => (
            <polyline key={i} points={p} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {data.days.map((d, i) =>
            d.remaining == null ? null : (
              <circle key={d.day} cx={x(i)} cy={y(d.remaining)} r={active === i ? 5 : 4} fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
            ),
          )}
          {lastKnown != null && (
            <text x={x(lastKnown) + 8} y={y(data.days[lastKnown].remaining!)} dy="0.32em" className="fill-foreground text-[11px] font-medium tabular-nums">
              {data.days[lastKnown].remaining} left
            </text>
          )}
          {active != null && <line x1={x(active)} x2={x(active)} y1={pad.t} y2={pad.t + ih} stroke="var(--foreground)" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="2 2" />}
          <rect
            x={pad.l}
            y={pad.t}
            width={iw}
            height={ih}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
            tabIndex={0}
            aria-label="Explore the burndown day by day with the arrow keys"
            onFocus={() => setActive(lastKnown ?? 0)}
            onBlur={() => setActive(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") setActive((v) => Math.min(data.days.length - 1, (v ?? -1) + 1));
              if (e.key === "ArrowLeft") setActive((v) => Math.max(0, (v ?? 1) - 1));
            }}
            className="outline-none focus-visible:stroke-ring"
          />
        </svg>
        {a && active != null && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 rounded-md border border-border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md"
            style={x(active) > width / 2 ? { right: width - x(active) + 8 } : { left: x(active) + 8 }}
          >
            <div className="text-muted-foreground">{fmtDay(a.day, { weekday: "short", month: "short", day: "numeric" })}</div>
            {a.remaining != null ? (
              <>
                <div className="font-medium tabular-nums">
                  {a.remaining} {unit} remaining
                </div>
                <div className="text-muted-foreground tabular-nums">
                  {a.done} done of {a.scope}
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">No snapshot</div>
            )}
            {data.ideal[active] && <div className="text-muted-foreground tabular-nums">Ideal {data.ideal[active].value}</div>}
          </div>
        )}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Show as table</summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Scope</th>
              <th className="py-1 text-right font-medium">Done</th>
              <th className="py-1 text-right font-medium">Remaining</th>
              <th className="py-1 text-right font-medium">Ideal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {data.days.map((d, i) => (
              <tr key={d.day}>
                <td className="py-1">{fmtDay(d.day, { weekday: "short", month: "short", day: "numeric" })}</td>
                <td className="py-1 text-right">{d.scope ?? "—"}</td>
                <td className="py-1 text-right">{d.done ?? "—"}</td>
                <td className="py-1 text-right">{d.remaining ?? "—"}</td>
                <td className="py-1 text-right">{data.ideal[i]?.value ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-muted-foreground">Units: {data.unit === "points" ? "story points" : "cards"}. Days show &ldquo;—&rdquo; before snapshots began or after the sprint ended.</p>
      </details>
    </figure>
  );
}
