import * as React from "react";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";

/** One consistent content column for every page in the app shell. Left-aligned on
 *  the same edge and top padding as the full-width boards, so titles don't jump
 *  around as you move between pages; the width cap only keeps lines readable. */
export function PageContainer({
  size = "default",
  className,
  children,
}: {
  size?: "default" | "wide" | "full";
  className?: string;
  children: React.ReactNode;
}) {
  const width = size === "full" ? "" : size === "wide" ? "max-w-7xl" : "max-w-6xl";
  return <div className={cn("w-full px-6 pt-5 pb-10", width, className)}>{children}</div>;
}

/** Page title block with optional eyebrow, description, and right-aligned actions. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      {/* min-w-64: on a phone, the actions wrap below the title instead of squeezing it. */}
      <div className="min-w-64 flex-1">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
        ) : null}
        {typeof title === "string" ? (
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        ) : (
          title
        )}
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Small uppercase section label (PHASES, DELIVERABLES, …) with optional action. */
export function SectionHeader({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </h2>
      {action}
    </div>
  );
}

/** The one look for a section's rows: a single bordered panel, rows divided by hairlines.
 *  Rows that carry `group` can use `ROW_ACTIONS` to reveal their buttons on hover. */
export function ListPanel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <ul className={cn("divide-y divide-border rounded-lg border border-border bg-surface", className)}>{children}</ul>;
}

/** Row buttons that stay out of the way until the row is hovered or focused; always
 *  shown on touch screens, where there's no hover. */
export const ROW_ACTIONS =
  "flex shrink-0 items-center gap-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

/** "+ Add a …" trigger under a list. */
export function AddRowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Plus className="size-4" aria-hidden="true" />
      {children}
    </button>
  );
}
