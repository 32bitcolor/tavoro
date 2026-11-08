import { z } from "zod";

// The fixed vocabularies for a card's type, priority and estimate (docs/JIRA-PARITY.md).
// Jira's defaults, so an import maps one to one. The database guards the same lists
// with CHECK constraints (migration card_type_priority_estimate).

export const CARD_TYPES = ["task", "bug", "story", "epic"] as const;
export type CardType = (typeof CARD_TYPES)[number];
export const CARD_TYPE_LABEL: Record<CardType, string> = { task: "Task", bug: "Bug", story: "Story", epic: "Epic" };

/** Highest first — the order pickers and sorts use. */
export const PRIORITIES = ["highest", "high", "medium", "low", "lowest"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = {
  highest: "Highest",
  high: "High",
  medium: "Medium",
  low: "Low",
  lowest: "Lowest",
};

export const ESTIMATE_UNITS = ["points", "hours"] as const;
export type EstimateUnit = (typeof ESTIMATE_UNITS)[number];

export const CardTypeSchema = z.enum(CARD_TYPES);
export const PrioritySchema = z.enum(PRIORITIES).nullable();
/** Up to two decimals (0.5 points, 1.25 hours); null clears it. */
export const EstimateSchema = z
  .number()
  .min(0)
  .max(10000)
  .transform((n) => Math.round(n * 100) / 100)
  .nullable();
export const EstimateUnitSchema = z.enum(ESTIMATE_UNITS);

export function asCardType(v: string | null | undefined): CardType {
  return (CARD_TYPES as readonly string[]).includes(v ?? "") ? (v as CardType) : "task";
}

export function asPriority(v: string | null | undefined): Priority | null {
  return (PRIORITIES as readonly string[]).includes(v ?? "") ? (v as Priority) : null;
}

/** "3 pts", "1 pt", "2.5 h". */
export function formatEstimate(n: number, unit: EstimateUnit): string {
  const v = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  if (unit === "hours") return `${v} h`;
  return `${v} ${n === 1 ? "pt" : "pts"}`;
}

/** Sort key: highest = 0 … lowest = 4, none last. */
export function priorityRank(p: string | null | undefined): number {
  const i = (PRIORITIES as readonly string[]).indexOf(p ?? "");
  return i < 0 ? PRIORITIES.length : i;
}
