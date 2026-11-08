import { BookmarkCheck, Bug, ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, Equal, SquareCheck, Zap } from "lucide-react";

import { CARD_TYPE_LABEL, PRIORITY_LABEL, formatEstimate, type CardType, type EstimateUnit, type Priority } from "@/lib/card-fields";
import { cn } from "@/lib/utils";

// Icons for a card's type, priority and estimate, shared by the board, list view,
// sprint board and drawer. Each carries its name as text for screen readers and a
// tooltip, so the meaning never rests on the colour or shape alone.

const TYPE_ICON = { task: SquareCheck, bug: Bug, story: BookmarkCheck, epic: Zap } as const;
const TYPE_TONE: Record<CardType, string> = {
  task: "text-accent",
  bug: "text-destructive-ink",
  story: "text-success-ink",
  epic: "text-epic-ink",
};

export function TypeIcon({ type, className }: { type: CardType; className?: string }) {
  const Icon = TYPE_ICON[type];
  const label = CARD_TYPE_LABEL[type];
  return (
    <span className={cn("inline-flex shrink-0", TYPE_TONE[type], className)} title={label}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

const PRIORITY_ICON = { highest: ChevronsUp, high: ChevronUp, medium: Equal, low: ChevronDown, lowest: ChevronsDown } as const;
const PRIORITY_TONE: Record<Priority, string> = {
  highest: "text-destructive-ink",
  high: "text-destructive-ink",
  medium: "text-warning-ink",
  low: "text-accent",
  lowest: "text-accent",
};

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const Icon = PRIORITY_ICON[priority];
  const label = `${PRIORITY_LABEL[priority]} priority`;
  return (
    <span className={cn("inline-flex shrink-0", PRIORITY_TONE[priority], className)} title={label}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function EstimateChip({ estimate, unit, className }: { estimate: number; unit: EstimateUnit; className?: string }) {
  return (
    <span
      className={cn("inline-flex h-5 items-center rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-foreground/80", className)}
      title={unit === "hours" ? "Estimate (hours)" : "Estimate (story points)"}
    >
      {formatEstimate(estimate, unit)}
    </span>
  );
}
