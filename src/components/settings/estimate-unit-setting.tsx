"use client";

import { useState } from "react";

import { setEstimateUnit } from "@/app/actions/cards";
import { Card } from "@/components/ui/card";
import type { EstimateUnit } from "@/lib/card-fields";

/** Settings → Cards & labels: what a card's estimate counts. */
export function EstimateUnitSetting({ initial }: { initial: EstimateUnit }) {
  const [unit, setUnit] = useState<EstimateUnit>(initial);
  const [status, setStatus] = useState<string | null>(null);

  async function choose(next: EstimateUnit) {
    if (next === unit) return;
    const prev = unit;
    setUnit(next);
    setStatus(null);
    const res = await setEstimateUnit(next);
    if (res && "error" in res) {
      setUnit(prev);
      setStatus(res.error ?? "Couldn’t save.");
    } else {
      setStatus("Saved.");
    }
  }

  return (
    <Card className="p-6">
      <fieldset>
        <legend className="mb-1 font-medium">Estimates</legend>
        <p className="mb-3 text-sm text-muted-foreground">
          What the number on a card counts. Sprint pages total it. Changing this relabels existing
          estimates; it doesn&rsquo;t convert them.
        </p>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["points", "Story points"],
              ["hours", "Hours"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="estimate-unit"
                value={value}
                checked={unit === value}
                onChange={() => choose(value)}
                className="size-4 accent-[var(--accent)]"
              />
              {label}
            </label>
          ))}
        </div>
        <p role="status" className="mt-2 min-h-4 text-xs text-muted-foreground">{status}</p>
      </fieldset>
    </Card>
  );
}
