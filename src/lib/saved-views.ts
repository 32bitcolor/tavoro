import { z } from "zod";

// The filter shapes a SavedView can hold, and the only place that knows them.
// Saved filters are user data that outlives the code that wrote it: a view saved
// today must still load after a filter is added or renamed. So every field is
// optional-with-a-default on read, and unknown keys are dropped rather than
// rejected — a stale view degrades to "the filters we still understand" instead
// of erroring or silently applying something the user can't see in the UI.

export const BOARD_VIEW_SCOPE = "board";
export const SPRINT_VIEW_SCOPE = "sprint";
export type ViewScope = typeof BOARD_VIEW_SCOPE | typeof SPRINT_VIEW_SCOPE;

export const DUE_FILTERS = ["any", "overdue", "week", "none"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

/** Board filter bar: multi-select labels/assignees, a due bucket, a title search. */
export const BoardFilters = z.object({
  labels: z.array(z.string()).default([]),
  assignees: z.array(z.string()).default([]),
  /** Card types (task/bug/story/epic). */
  types: z.array(z.string()).default([]),
  /** Priorities, plus "none" for cards without one. */
  priorities: z.array(z.string()).default([]),
  due: z.enum(DUE_FILTERS).default("any"),
  search: z.string().default(""),
});
export type BoardFilters = z.infer<typeof BoardFilters>;

/** Sprint board: single-select project/assignee/label ("" = no filter). */
export const SprintFilters = z.object({
  project: z.string().default(""),
  assignee: z.string().default(""),
  label: z.string().default(""),
});
export type SprintFilters = z.infer<typeof SprintFilters>;

export const ViewScopeEnum = z.enum([BOARD_VIEW_SCOPE, SPRINT_VIEW_SCOPE]);
export const ViewName = z.string().trim().min(1).max(60);

/** Parse stored JSON for a scope, falling back to "no filters" if it's unusable. */
export function parseFilters(scope: string, raw: unknown): BoardFilters | SprintFilters {
  const schema = scope === SPRINT_VIEW_SCOPE ? SprintFilters : BoardFilters;
  const parsed = schema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}

/** True when a filter set would actually narrow anything — used to refuse saving
 *  an empty view, which would be indistinguishable from "Clear". */
export function filtersAreActive(scope: string, f: BoardFilters | SprintFilters): boolean {
  if (scope === SPRINT_VIEW_SCOPE) {
    const s = f as SprintFilters;
    return !!(s.project || s.assignee || s.label);
  }
  const b = f as BoardFilters;
  return (
    b.labels.length > 0 ||
    b.assignees.length > 0 ||
    b.types.length > 0 ||
    b.priorities.length > 0 ||
    b.due !== "any" ||
    b.search.trim() !== ""
  );
}
