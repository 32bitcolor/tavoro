"use client";

import * as React from "react";
import Link from "next/link";

import type { VelocityRow } from "@/lib/sprint-stats";
import { cn } from "@/lib/utils";

// Velocity: per completed sprint, what it committed to (a recessive outline, the target)
// and what it completed (a solid accent column inside it). One unit, one axis. Each
// sprint is focusable for its numbers, and the table view carries every value.

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

export function VelocityChart({ rows, unit, average }: { rows: VelocityRow[]; unit: "points" | "cards"; average: number | null }) {
  const [active, setActive] = React.useState<number | null>(null);
  const label = unit === "points" ? "pts" : "cards";
  const { top, ticks } = niceTop(Math.max(...rows.map((r) => Math.max(r.committed, r.completed)), 0));
  const pct = (v: number) => `${(v / top) * 100}%`;

  return (
    <figure className="rounded-lg border border-border bg-surface p-4">
      <figcaption className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">Velocity</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2.5 rounded-[2px] bg-accent" aria-hidden="true" />
          Completed
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2.5 rounded-[2px] border-2 border-chart-ref" aria-hidden="true" />
          Committed
        </span>
        {average != null && (
          <span className="ml-auto text-xs text-muted-foreground">
            {rows.length === 1 ? "Average" : `Average of the last ${Math.min(3, rows.length)}`}: <span className="font-medium text-foreground tabular-nums">{average} {label}</span>
          </span>
        )}
      </figcaption>
      <div className="flex gap-2">
        <div className="relative h-44 w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (t / top) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-44" onPointerLeave={() => setActive(null)}>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 h-px bg-border" style={{ top: `${100 - (t / top) * 100}%` }} aria-hidden="true" />
            ))}
            <ul className="absolute inset-0 flex items-end gap-[2px]" aria-label="Velocity by sprint">
              {rows.map((r, i) => (
                <li key={r.id} className="relative flex h-full flex-1 items-end justify-center">
                  <button
                    type="button"
                    className="absolute inset-0 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    aria-label={`${r.name}: ${r.completed} of ${r.committed} ${label} completed`}
                    onPointerEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  />
                  <span className="pointer-events-none relative flex h-full w-[min(36px,70%)] items-end">
                    {/* Committed: the outline the completed column fills. */}
                    <span className="absolute inset-x-0 bottom-0 rounded-t-[4px] border-2 border-b-0 border-chart-ref" style={{ height: pct(r.committed) }} />
                    <span
                      className={cn("relative w-full rounded-t-[4px] bg-accent transition-opacity", active !== null && active !== i && "opacity-60")}
                      style={{ height: r.completed > 0 ? `max(2px, ${pct(r.completed)})` : 0 }}
                    />
                  </span>
                  {active === i && (
                    <div role="presentation" className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-md border border-border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md">
                      <div className="font-medium">{r.name}</div>
                      <div className="tabular-nums">
                        {r.completed} of {r.committed} {label} completed
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-1.5 flex gap-[2px] text-[11px] text-muted-foreground" aria-hidden="true">
            {rows.map((r, i) => (
              <span key={r.id} className={cn("min-w-0 flex-1 truncate text-center", rows.length > 4 && i % 2 === 1 && "max-sm:invisible")}>
                {r.name}
              </span>
            ))}
          </div>
        </div>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Show as table</summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="py-1 font-medium">Sprint</th>
              <th className="py-1 text-right font-medium">Committed</th>
              <th className="py-1 text-right font-medium">Completed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-1">
                  <Link href={`/sprints/${r.id}/report`} className="hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="py-1 text-right">{r.committed}</td>
                <td className="py-1 text-right">{r.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
