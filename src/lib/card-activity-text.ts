// How a card's History reads (docs/JIRA-PARITY.md). Pure, so the drawer and MCP share it.
// Each entry's data holds display values captured when it happened.

export type ActivityKind =
  | "created"
  | "title"
  | "status"
  | "assignee"
  | "sme"
  | "label"
  | "priority"
  | "estimate"
  | "type"
  | "due"
  | "sprint"
  | "epic"
  | "link"
  | "moved"
  | "description"
  | "subtask"
  | "private"
  | "imported";

export type ActivityData = {
  from?: string | null;
  to?: string | null;
  added?: string;
  removed?: string;
  [k: string]: unknown;
};

const q = (s: string | null | undefined) => (s ? `“${s}”` : "none");
const v = (s: string | null | undefined) => s || "none";

/** "changed the priority from High to Low" — the actor's name goes in front. */
export function describeActivity(kind: string, data: ActivityData): string {
  switch (kind) {
    case "created":
      return "created the card";
    case "title":
      return `renamed it from ${q(data.from)} to ${q(data.to)}`;
    case "status":
      return `moved it from ${v(data.from)} to ${v(data.to)}`;
    case "assignee":
      return data.added ? `assigned ${data.added}` : `unassigned ${data.removed}`;
    case "sme":
      return data.added ? `added ${data.added} as an SME` : `removed ${data.removed} as an SME`;
    case "label":
      return data.added ? `added the label ${data.added}` : `removed the label ${data.removed}`;
    case "priority":
      return `changed the priority from ${v(data.from)} to ${v(data.to)}`;
    case "estimate":
      return `changed the estimate from ${v(data.from)} to ${v(data.to)}`;
    case "type":
      return `changed the type from ${v(data.from)} to ${v(data.to)}`;
    case "due":
      return data.to ? (data.from ? `moved the due date from ${data.from} to ${data.to}` : `set the due date to ${data.to}`) : "cleared the due date";
    case "sprint":
      return data.to ? (data.from ? `moved it from ${data.from} to ${data.to}` : `added it to ${data.to}`) : `took it out of ${v(data.from)}`;
    case "epic":
      return data.to ? (data.from ? `moved it from the epic ${q(data.from)} to ${q(data.to)}` : `added it to the epic ${q(data.to)}`) : `took it out of the epic ${q(data.from)}`;
    case "link":
      return data.added ? `linked: ${data.added}` : `removed the link: ${data.removed}`;
    case "moved":
      return `moved it from the board ${v(data.from)} to ${v(data.to)}${data.oldKey ? ` (was ${data.oldKey})` : ""}`;
    case "description":
      return "edited the description";
    case "subtask":
      return data.added ? `added the subtask ${q(data.added)}` : `removed the subtask ${q(data.removed)}`;
    case "private":
      return data.to === "private" ? "made it private" : "made it not private";
    case "imported":
      return `imported it from ${v(data.source as string)}`;
    default:
      return "changed it";
  }
}
