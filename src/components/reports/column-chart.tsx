"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type ChartBucket = { label: string; range: string; value: number; estimated?: boolean };

/** Round a max up to a clean axis top (1, 2, 5 × 10ⁿ steps) with ~4 gridlines. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step * 0.001; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Single-series column chart: one bar per time bucket, in the theme accent. Each bar
 *  is focusable and shows its value on hover/focus; a table view carries every value
 *  for anyone who can't use the chart. */
export function ColumnChart({
  title,
  buckets,
  unit,
  decimals = 0,
}: {
  title: string;
  buckets: ChartBucket[];
  /** Plural unit shown in the tooltip and table, e.g. "requests", "hours". */
  unit: string;
  decimals?: number;
}) {
  const [active, setActive] = React.useState<number | null>(null);
  const ticks = niceTicks(Math.max(...buckets.map((b) => b.value), 0));
  const top = ticks[ticks.length - 1];
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
  // Thin the x labels so they never collide: at most ~7 across, ~3 on a phone.
  const every = Math.max(1, Math.ceil(buckets.length / 7));
  const everyNarrow = Math.max(1, Math.ceil(buckets.length / 3));
  const estimatedNote = (b: ChartBucket) => (b.estimated ? " (includes estimated dates)" : "");

  return (
    <figure className="rounded-lg border border-border bg-surface p-4">
      <figcaption className="mb-3 text-sm font-medium">{title}</figcaption>
      <div className="flex gap-2">
        {/* y-axis ticks */}
        <div className="relative h-40 w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (t / top) * 100}%` }}>
              {compact.format(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-40" onPointerLeave={() => setActive(null)}>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 h-px bg-border" style={{ top: `${100 - (t / top) * 100}%` }} aria-hidden="true" />
            ))}
            <ul className="absolute inset-0 flex items-end" aria-label={title}>
              {buckets.map((b, i) => (
                <li key={i} className="relative flex h-full flex-1 items-end justify-center">
                  {/* The whole column slot is the hit target, not just the painted bar. */}
                  <button
                    type="button"
                    className="group absolute inset-0 flex items-end justify-center rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    aria-label={`${b.range}: ${fmt(b.value)} ${unit}${estimatedNote(b)}`}
                    onPointerEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  >
                    <span
                      className={cn(
                        "block w-[min(24px,70%)] rounded-t-[4px] bg-accent transition-opacity",
                        b.estimated && "opacity-45",
                        active !== null && active !== i && "opacity-60",
                      )}
                      style={{ height: b.value > 0 ? `max(2px, ${(b.value / top) * 100}%)` : 0 }}
                    />
                  </button>
                  {active === i && (
                    <div
                      role="presentation"
                      className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
                    >
                      <div className="text-muted-foreground">{b.range}</div>
                      <div className="font-medium tabular-nums">
                        {fmt(b.value)} {unit}
                      </div>
                      {b.estimated ? <div className="text-muted-foreground">Includes estimated dates</div> : null}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-1.5 flex text-[11px] text-muted-foreground" aria-hidden="true">
            {buckets.map((b, i) => (
              <span
                key={i}
                className={cn(
                  "min-w-0 flex-1 whitespace-nowrap text-center",
                  i % every !== 0 && "invisible",
                  i % everyNarrow !== 0 && "max-sm:invisible",
                )}
              >
                {b.label}
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
              <th className="py-1 font-medium">Period</th>
              <th className="py-1 text-right font-medium capitalize">{unit}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {buckets.map((b, i) => (
              <tr key={i}>
                <td className="py-1">
                  {b.range}
                  {b.estimated ? <span className="text-muted-foreground"> · estimated</span> : null}
                </td>
                <td className="py-1 text-right tabular-nums">{fmt(b.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
