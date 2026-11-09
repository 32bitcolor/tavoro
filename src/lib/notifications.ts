// The canonical list of email-notification categories admins can toggle in
// Settings → Notifications. Kept pure (no server-only imports) so the worker's
// reminder job can read the same enabled-check as the app's server actions.

export const NOTIFICATION_TYPES = [
  {
    key: "assignment",
    label: "Assignments",
    description: "When someone is assigned to a card, subtask or intake request, or named as an SME.",
  },
  {
    key: "status_change",
    label: "Status changes",
    description: "When a card moves to a new status, or a subtask is completed or reopened.",
  },
  {
    key: "comment",
    label: "Comments",
    description: "New comments on a card you're assigned to or an SME on.",
  },
  {
    key: "watching",
    label: "Cards you watch",
    description: "When a card someone watches gets a new assignee or priority. (Status changes and comments on watched cards follow those settings.)",
  },
  {
    key: "mention",
    label: "Mentions",
    description: "When you're @-mentioned in a comment or a card description.",
  },
  {
    key: "review",
    label: "Reviews",
    description: "Review requests, and decisions on reviews you requested.",
  },
  {
    key: "intake",
    label: "Intake requests",
    description: "New stakeholder requests (to admins), and requesters' replies on their status page (to the assignee, or admins and managers).",
  },
  {
    key: "member",
    label: "Member accounts",
    description: "Welcome emails for new members and password-reset notices.",
  },
  {
    key: "reminders",
    label: "Due-date reminders",
    description: "A nudge the day before a card or milestone is due.",
  },
  {
    key: "lifecycle",
    label: "Content reviews & expiry",
    description: "Ahead of a tracked item's review date (30 and 7 days) and expiry date (60, 30 and 7 days), to its owner, or admins and managers when it has none.",
  },
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]["key"];

const KEYS = new Set(NOTIFICATION_TYPES.map((t) => t.key));

/**
 * Whether a given notification type is enabled for a workspace, given its stored
 * `notificationSettings` JSON (a partial `{ [type]: boolean }` map). Types are
 * opt-out: anything not explicitly set to `false` is enabled, so new types light
 * up automatically and a null/absent settings blob means "all on".
 */
export function notificationEnabled(settings: unknown, type: NotificationType): boolean {
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    return (settings as Record<string, unknown>)[type] !== false;
  }
  return true;
}

/** Normalize stored settings into a full map of every known type → boolean, for the settings UI. */
export function notificationSettingsMap(settings: unknown): Record<NotificationType, boolean> {
  const out = {} as Record<NotificationType, boolean>;
  for (const t of NOTIFICATION_TYPES) out[t.key] = notificationEnabled(settings, t.key);
  return out;
}

/** Keep only recognized keys, coercing values to booleans — guards the admin write path. */
export function sanitizeNotificationSettings(input: Record<string, unknown>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input)) {
    if (KEYS.has(k as NotificationType)) out[k] = Boolean(v);
  }
  return out;
}
