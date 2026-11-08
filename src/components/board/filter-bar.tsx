"use client";

import { useEffect, useRef } from "react";
import { CalendarClock, ChevronDown, Flag, Layers, Search, Tag, User, X, Zap } from "lucide-react";
import { CARD_TYPES, CARD_TYPE_LABEL, PRIORITIES, PRIORITY_LABEL } from "@/lib/card-fields";
import { PriorityIcon, TypeIcon } from "@/components/shared/card-fields";

import { SavedViewsMenu } from "@/components/shared/saved-views-menu";
import type { SavedViewDTO } from "@/app/actions/saved-views";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Label = { id: string; name: string; color: string };
type Member = { id: string; name: string | null; email: string };
export type DueFilter = "any" | "overdue" | "week" | "none";

const DUE_LABEL: Record<DueFilter, string> = {
  any: "Due date",
  overdue: "Overdue",
  week: "Due this week",
  none: "No due date",
};

/** One row: search, filter chips, saved views — and a clear/count when filtering. */
export function FilterBar({
  labels,
  members,
  selectedLabels,
  onToggleLabel,
  selectedAssignees,
  onToggleAssignee,
  selectedTypes,
  onToggleType,
  selectedPriorities,
  onTogglePriority,
  epics,
  selectedEpics,
  onToggleEpic,
  due,
  onDue,
  search,
  onSearch,
  active,
  onClear,
  visible,
  total,
  boardId,
  currentFilters,
  activeViewId,
  onApplyView,
}: {
  labels: Label[];
  members: Member[];
  selectedLabels: Set<string>;
  onToggleLabel: (id: string) => void;
  selectedAssignees: Set<string>;
  onToggleAssignee: (id: string) => void;
  selectedTypes: Set<string>;
  onToggleType: (type: string) => void;
  selectedPriorities: Set<string>;
  onTogglePriority: (priority: string) => void;
  epics: { id: string; title: string }[];
  selectedEpics: Set<string>;
  onToggleEpic: (id: string) => void;
  due: DueFilter;
  onDue: (d: DueFilter) => void;
  search: string;
  onSearch: (s: string) => void;
  active: boolean;
  onClear: () => void;
  visible: number;
  total: number;
  boardId: string;
  currentFilters: () => unknown;
  activeViewId: string | null;
  onApplyView: (view: SavedViewDTO | null) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search, as in most keyboard-first tools — unless the user is
  // already typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const labelSummary = summarize(labels.filter((l) => selectedLabels.has(l.id)).map((l) => l.name));
  const assigneeSummary = summarize(
    members.filter((m) => selectedAssignees.has(m.id)).map((m) => m.name ?? m.email),
  );

  const typeSummary = summarize(CARD_TYPES.filter((t) => selectedTypes.has(t)).map((t) => CARD_TYPE_LABEL[t]));
  const prioritySummary = summarize(
    [...PRIORITIES, "none" as const]
      .filter((p) => selectedPriorities.has(p))
      .map((p) => (p === "none" ? "No priority" : PRIORITY_LABEL[p])),
  );

  const epicSummary = summarize([
    ...epics.filter((e) => selectedEpics.has(e.id)).map((e) => e.title),
    ...(selectedEpics.has("none") ? ["No epic"] : []),
  ]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex h-8 w-56 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="sr-only">Search cards</span>
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLInputElement).blur()}
          placeholder="Search cards"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden rounded border border-border px-1.5 font-mono text-[11px] sm:inline">/</kbd>
      </label>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <FilterChip icon={<Tag className="size-3.5" />} label="Label" current={labelSummary} disabled={labels.length === 0} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
          <DropdownMenuLabel>Labels</DropdownMenuLabel>
          {labels.map((l) => (
            <DropdownMenuCheckboxItem
              key={l.id}
              checked={selectedLabels.has(l.id)}
              onCheckedChange={() => onToggleLabel(l.id)}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: l.color }} aria-hidden="true" />
              <span className="truncate">{l.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <FilterChip icon={<User className="size-3.5" />} label="Assignee" current={assigneeSummary} disabled={members.length === 0} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
          <DropdownMenuLabel>Assignees</DropdownMenuLabel>
          {members.map((m) => (
            <DropdownMenuCheckboxItem
              key={m.id}
              checked={selectedAssignees.has(m.id)}
              onCheckedChange={() => onToggleAssignee(m.id)}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="truncate">{m.name ?? m.email}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <FilterChip icon={<Layers className="size-3.5" />} label="Type" current={typeSummary} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel>Types</DropdownMenuLabel>
          {CARD_TYPES.map((t) => (
            <DropdownMenuCheckboxItem
              key={t}
              checked={selectedTypes.has(t)}
              onCheckedChange={() => onToggleType(t)}
              onSelect={(e) => e.preventDefault()}
            >
              <TypeIcon type={t} />
              <span aria-hidden="true">{CARD_TYPE_LABEL[t]}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <FilterChip icon={<Flag className="size-3.5" />} label="Priority" current={prioritySummary} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel>Priorities</DropdownMenuLabel>
          {PRIORITIES.map((p) => (
            <DropdownMenuCheckboxItem
              key={p}
              checked={selectedPriorities.has(p)}
              onCheckedChange={() => onTogglePriority(p)}
              onSelect={(e) => e.preventDefault()}
            >
              <PriorityIcon priority={p} />
              <span aria-hidden="true">{PRIORITY_LABEL[p]}</span>
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuCheckboxItem
            checked={selectedPriorities.has("none")}
            onCheckedChange={() => onTogglePriority("none")}
            onSelect={(e) => e.preventDefault()}
          >
            <span className="size-3.5 shrink-0" aria-hidden="true" />
            No priority
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <FilterChip icon={<Zap className="size-3.5" />} label="Epic" current={epicSummary} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
          <DropdownMenuLabel>Epics</DropdownMenuLabel>
          {epics.map((e) => (
            <DropdownMenuCheckboxItem
              key={e.id}
              checked={selectedEpics.has(e.id)}
              onCheckedChange={() => onToggleEpic(e.id)}
              onSelect={(ev) => ev.preventDefault()}
            >
              <span className="truncate">{e.title}</span>
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuCheckboxItem
            checked={selectedEpics.has("none")}
            onCheckedChange={() => onToggleEpic("none")}
            onSelect={(ev) => ev.preventDefault()}
          >
            No epic
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <FilterChip
            icon={<CalendarClock className="size-3.5" />}
            label="Due date"
            current={due === "any" ? null : DUE_LABEL[due]}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuRadioGroup value={due} onValueChange={(v) => onDue(v as DueFilter)}>
            {(Object.keys(DUE_LABEL) as DueFilter[]).map((k) => (
              <DropdownMenuRadioItem key={k} value={k}>
                {k === "any" ? "Any due date" : DUE_LABEL[k]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {active && (
        <>
          <Button variant="ghost" size="sm" onClick={onClear} className="h-8 text-muted-foreground">
            <X className="size-3.5" aria-hidden="true" />
            Clear
          </Button>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {visible} of {total} cards
          </span>
        </>
      )}

      <span className="flex-1" />

      <SavedViewsMenu
        scope="board"
        boardId={boardId}
        currentFilters={currentFilters}
        filtersActive={active}
        activeViewId={activeViewId}
        onApply={onApplyView}
      />
    </div>
  );
}

function summarize(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

/** A filter trigger: dashed and quiet when unset, solid and showing its value when set. */
export function FilterChip({
  icon,
  label,
  current,
  disabled,
  ...props
}: {
  icon: React.ReactNode;
  label: string;
  current: string | null;
  disabled?: boolean;
} & Omit<React.ComponentProps<"button">, "value">) {
  const set = current != null;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={set ? `${label}: ${current}` : label}
      {...props}
      className={cn(
        "inline-flex h-8 max-w-56 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
        set
          ? "border-accent/40 bg-accent/10 text-foreground"
          : "border-dashed border-border-strong text-muted-foreground hover:bg-hover hover:text-foreground",
      )}
    >
      <span className="shrink-0" aria-hidden="true">{icon}</span>
      <span className="truncate">{set ? current : label}</span>
      <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
    </button>
  );
}
