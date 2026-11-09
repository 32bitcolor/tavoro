// Automation rules (docs/JIRA-PARITY.md, phase 9): what can start a rule, and what it
// can do. Pure and client-safe; the worker runs them (engine.ts). Things are named, not
// referenced by id (status "Done", label "qa", maya@example.com, field "Audience"), so a
// rule reads clearly, survives a backup and restore, and fails loudly in its run log if
// something it names is renamed or removed.
import { z } from "zod";

export const TRIGGERS = ["card_created", "status_changed", "field_changed", "comment_added", "subtasks_done", "due_soon", "schedule"] as const;
export type TriggerKind = (typeof TRIGGERS)[number];
export const WATCHED_FIELDS = ["assignee", "priority", "label", "due", "type", "estimate", "sprint", "epic", "custom"] as const;

export const Trigger = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("card_created") }),
  z.object({ kind: z.literal("status_changed"), to: z.string().trim().max(60).default("") }),
  z.object({ kind: z.literal("field_changed"), field: z.enum(WATCHED_FIELDS), custom: z.string().trim().max(60).default("") }),
  z.object({ kind: z.literal("comment_added") }),
  z.object({ kind: z.literal("subtasks_done") }),
  z.object({ kind: z.literal("due_soon"), days: z.number().int().min(0).max(60) }),
  z.object({ kind: z.literal("schedule"), every: z.enum(["day", "week"]) }),
]);
export type Trigger = z.infer<typeof Trigger>;

const Name = z.string().trim().min(1, "Fill this in.").max(120);
export const Action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set_status"), status: Name }),
  z.object({ kind: z.literal("assign"), person: Name }),
  z.object({ kind: z.literal("unassign"), person: Name }), // an email, or "everyone"
  z.object({ kind: z.literal("set_priority"), priority: z.enum(["highest", "high", "medium", "low", "lowest", "none"]) }),
  z.object({ kind: z.literal("add_label"), label: Name }),
  z.object({ kind: z.literal("remove_label"), label: Name }),
  z.object({ kind: z.literal("set_field"), field: Name, value: z.string().trim().max(500) }),
  z.object({ kind: z.literal("set_due"), days: z.number().int().min(-365).max(365).nullable() }),
  z.object({ kind: z.literal("add_comment"), text: z.string().trim().min(1, "Write the comment.").max(4000) }),
  z.object({ kind: z.literal("add_subtask"), title: Name }),
  z.object({ kind: z.literal("watch"), person: Name }),
  z.object({ kind: z.literal("notify"), to: z.enum(["assignees", "watchers", "person"]), person: z.string().trim().max(200).default(""), message: z.string().trim().min(1, "Write the message.").max(2000) }),
]);
export type Action = z.infer<typeof Action>;
export type ActionKind = Action["kind"];

export const RuleInput = z.object({
  name: z.string().trim().min(1, "Name the rule.").max(120),
  enabled: z.boolean().default(true),
  boardId: z.string().nullable(),
  trigger: Trigger,
  condition: z.string().max(2000).default(""),
  actions: z.array(Action).min(1, "Add at least one action.").max(10),
});
export type RuleInput = z.infer<typeof RuleInput>;

export const TRIGGER_LABEL: Record<TriggerKind, string> = {
  card_created: "A card is created",
  status_changed: "A card's status changes",
  field_changed: "A field changes",
  comment_added: "Someone comments",
  subtasks_done: "All of a card's subtasks are done",
  due_soon: "A due date is coming up",
  schedule: "On a schedule",
};

export const ACTION_LABEL: Record<ActionKind, string> = {
  set_status: "Move to a status",
  assign: "Assign someone",
  unassign: "Unassign",
  set_priority: "Set the priority",
  add_label: "Add a label",
  remove_label: "Remove a label",
  set_field: "Set a custom field",
  set_due: "Set the due date",
  add_comment: "Add a comment",
  add_subtask: "Add a subtask",
  watch: "Add a watcher",
  notify: "Email people",
};

export function describeTrigger(t: Trigger): string {
  switch (t.kind) {
    case "status_changed":
      return t.to ? `the status changes to ${t.to}` : "the status changes";
    case "field_changed":
      return t.field === "custom" ? `“${t.custom}” changes` : `the ${t.field} changes`;
    case "due_soon":
      return t.days === 0 ? "a card is due today" : `a card is due in ${t.days} ${t.days === 1 ? "day" : "days"}`;
    case "schedule":
      return t.every === "day" ? "every day (7:00 UTC)" : "every Monday (7:00 UTC)";
    case "card_created":
      return "a card is created";
    case "comment_added":
      return "someone comments";
    case "subtasks_done":
      return "all of a card's subtasks are done";
  }
}

export function describeAction(a: Action): string {
  switch (a.kind) {
    case "set_status":
      return `move it to ${a.status}`;
    case "assign":
      return `assign ${a.person}`;
    case "unassign":
      return a.person === "everyone" ? "unassign everyone" : `unassign ${a.person}`;
    case "set_priority":
      return a.priority === "none" ? "clear the priority" : `set priority ${a.priority}`;
    case "add_label":
      return `add the label ${a.label}`;
    case "remove_label":
      return `remove the label ${a.label}`;
    case "set_field":
      return a.value ? `set “${a.field}” to ${a.value}` : `clear “${a.field}”`;
    case "set_due":
      return a.days === null ? "clear the due date" : a.days === 0 ? "make it due today" : `make it due in ${a.days} days`;
    case "add_comment":
      return "add a comment";
    case "add_subtask":
      return `add the subtask “${a.title}”`;
    case "watch":
      return `add ${a.person} as a watcher`;
    case "notify":
      return a.to === "person" ? `email ${a.person}` : `email its ${a.to}`;
  }
}

/** "When the status changes to Done, if priority >= high: assign …, add a comment." */
export function describeRule(r: { trigger: Trigger; condition: string; actions: Action[] }): string {
  const when = `When ${describeTrigger(r.trigger)}`;
  const iff = r.condition.trim() ? `, if ${r.condition.trim()}` : "";
  return `${when}${iff}: ${r.actions.map(describeAction).join(", ")}.`;
}

/** The app event a card activity becomes (null = rules don't react to it). */
export function eventForActivity(kind: string): { trigger: TriggerKind; field?: (typeof WATCHED_FIELDS)[number] } | null {
  if (kind === "created") return { trigger: "card_created" };
  if (kind === "status") return { trigger: "status_changed" };
  if (["assignee", "priority", "label", "due", "type", "estimate", "sprint", "epic"].includes(kind)) return { trigger: "field_changed", field: kind as (typeof WATCHED_FIELDS)[number] };
  if (kind === "field") return { trigger: "field_changed", field: "custom" };
  return null;
}

/** A rule's runs per card are capped, so two rules feeding each other stop. */
export const MAX_DEPTH = 3;
export const MAX_RUNS_PER_CARD_PER_MINUTE = 10;
