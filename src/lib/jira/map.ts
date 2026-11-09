// Jira → Tavoro mapping rules, and the shapes a JiraImport row keeps. Pure (unit-tested
// in map.test.ts) and free of server-only imports, since the worker uses it too.
import type { JiraField, JiraIssue, JiraLink, JiraSprint } from "./client";

export type StatusCategory = "todo" | "active" | "done";
export type TavoroType = "task" | "bug" | "story" | "epic";

/** A Jira project and where it goes. */
export type ImportProject = {
  id: string;
  key: string;
  name: string;
  target: { kind: "new"; name: string; prefix: string } | { kind: "board"; boardId: string };
};

export type StatusMap = { jiraId: string; jiraName: string; category: StatusCategory; statusId: string | null };
export type UserMap = { accountId: string; displayName: string; email: string | null; memberId: string | null; how: "email" | "name" | "manual" | null };
export type TypeMap = { jiraName: string; subtask: boolean; to: TavoroType | "subtask" };

export type ImportMapping = {
  statuses: StatusMap[];
  users: UserMap[];
  types: TypeMap[];
  fields: { points: string | null; sprint: string | null; epicLink: string | null; rank: string | null };
  componentsAsLabels: boolean;
};

export type ScanResult = {
  at: string;
  projects: { key: string; issues: number; subtasks: number; epics: number }[];
  issues: number;
  comments: number;
  attachments: number;
  attachmentBytes: number;
  attachmentsTooBig: number;
  sprints: number;
  links: number;
  labels: number;
  /** Link types that come over as "relates to". */
  otherLinkTypes: string[];
  notImported: string[];
  /** Number fields the admin can pick story points from. */
  numberFields: { id: string; name: string }[];
};

export type ImportReport = {
  boards: { projectKey: string; boardId: string; name: string; created: boolean }[];
  counts: {
    cardsCreated: number;
    cardsUpdated: number;
    subtasks: number;
    comments: number;
    attachments: number;
    sprints: number;
    links: number;
    watchers: number;
    labelsCreated: number;
    statusesCreated: number;
  };
  /** Fields left alone on a re-run because someone changed them in Tavoro. */
  keptLocal: number;
  /** Cards whose Tavoro key differs from their Jira key. */
  rekeyed: { jira: string; tavoro: string }[];
  skipped: { key?: string; what: string; why: string }[];
  requests: number;
};

export const emptyReport = (): ImportReport => ({
  boards: [],
  counts: { cardsCreated: 0, cardsUpdated: 0, subtasks: 0, comments: 0, attachments: 0, sprints: 0, links: 0, watchers: 0, labelsCreated: 0, statusesCreated: 0 },
  keptLocal: 0,
  rekeyed: [],
  skipped: [],
  requests: 0,
});

/** Same per-file limit as chunked uploads in the app. */
export const MAX_IMPORT_ATTACHMENT_BYTES = 95 * 1024 * 1024;

export const NOT_IMPORTED = [
  "Custom fields other than story points",
  "Worklogs and time tracking",
  "Votes",
  "Workflows, transitions and automation rules",
  "Permission schemes and issue security",
  "Change history (each card gets one “Imported from Jira” entry instead)",
];

export function statusCategory(jiraKey: string | undefined): StatusCategory {
  if (jiraKey === "done") return "done";
  if (jiraKey === "new" || jiraKey === "undefined") return "todo";
  return "active";
}

export function defaultType(name: string, subtask: boolean, hierarchyLevel?: number): TavoroType | "subtask" {
  if (subtask || hierarchyLevel === -1) return "subtask";
  const n = name.trim().toLowerCase();
  if (n === "epic" || hierarchyLevel === 1) return "epic";
  if (n === "bug" || n === "defect") return "bug";
  if (n === "story" || n === "user story") return "story";
  return "task";
}

const PRIORITY: Record<string, "highest" | "high" | "medium" | "low" | "lowest"> = {
  highest: "highest",
  blocker: "highest",
  critical: "highest",
  urgent: "highest",
  high: "high",
  major: "high",
  medium: "medium",
  normal: "medium",
  low: "low",
  minor: "low",
  lowest: "lowest",
  trivial: "lowest",
};

export function priorityOf(name: string | undefined | null) {
  return name ? (PRIORITY[name.trim().toLowerCase()] ?? null) : null;
}

/** The Tavoro link choice (read from `issue`'s side) for one of its Jira links. */
export function linkChoice(l: JiraLink): { otherId: string; choice: "blocks" | "blocked_by" | "relates" | "duplicates" | "duplicated_by" | "clones" | "cloned_by"; known: boolean } | null {
  const outward = !!l.outwardIssue;
  const other = l.outwardIssue ?? l.inwardIssue;
  if (!other) return null;
  const t = l.type.name.trim().toLowerCase();
  if (t === "blocks" || t === "blocker") return { otherId: other.id, choice: outward ? "blocks" : "blocked_by", known: true };
  if (t === "duplicate" || t === "duplicates") return { otherId: other.id, choice: outward ? "duplicates" : "duplicated_by", known: true };
  if (t === "cloners" || t === "clones") return { otherId: other.id, choice: outward ? "clones" : "cloned_by", known: true };
  return { otherId: other.id, choice: "relates", known: t === "relates" };
}

/** Find the fields Jira keeps sprints, story points, epic links and rank in. */
export function findFields(fields: JiraField[]): ImportMapping["fields"] {
  const byCustom = (c: string) => fields.find((f) => f.schema?.custom === c)?.id ?? null;
  const byName = (...names: string[]) =>
    names.map((n) => fields.find((f) => f.name.trim().toLowerCase() === n && (f.schema?.type === "number" || !f.schema?.type))?.id).find(Boolean) ?? null;
  return {
    points: byName("story point estimate", "story points", "story point") ?? byCustom("com.atlassian.jira.plugin.system.customfieldtypes:float"),
    sprint: byCustom("com.pyxis.greenhopper.jira:gh-sprint"),
    epicLink: byCustom("com.pyxis.greenhopper.jira:gh-epic-link"),
    rank: byCustom("com.pyxis.greenhopper.jira:gh-lexo-rank"),
  };
}

export function numberFields(fields: JiraField[]) {
  return fields.filter((f) => f.custom && f.schema?.type === "number").map((f) => ({ id: f.id, name: f.name }));
}

const SPRINT_STATE: Record<string, number> = { closed: 0, active: 1, future: 2 };

/** A card in several sprints goes to the latest: future, then active, then the most recent closed one. */
export function latestSprint(sprints: JiraSprint[]): JiraSprint | null {
  let best: JiraSprint | null = null;
  for (const s of sprints) {
    if (!best) best = s;
    else {
      const a = SPRINT_STATE[s.state] ?? 0;
      const b = SPRINT_STATE[best.state] ?? 0;
      if (a > b || (a === b && s.id > best.id)) best = s;
    }
  }
  return best;
}

export function sprintStatus(state: string): "planned" | "active" | "completed" {
  return state === "active" ? "active" : state === "closed" ? "completed" : "planned";
}

/** Sprint field values: objects on Cloud; older sites send strings like "…[id=1,state=ACTIVE,name=S1,…]". */
export function parseSprints(v: unknown): JiraSprint[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): JiraSprint[] => {
    if (x && typeof x === "object" && "id" in x) {
      const o = x as Record<string, unknown>;
      return [{ id: Number(o.id), name: String(o.name ?? `Sprint ${o.id}`), state: String(o.state ?? "future").toLowerCase(), goal: o.goal ? String(o.goal) : undefined, startDate: o.startDate as string | undefined, endDate: o.endDate as string | undefined, completeDate: o.completeDate as string | undefined }];
    }
    if (typeof x === "string") {
      const get = (k: string) => new RegExp(`[\\[,]${k}=([^,\\]]*)`).exec(x)?.[1];
      const id = Number(get("id"));
      if (!Number.isFinite(id)) return [];
      const d = (k: string) => {
        const s = get(k);
        return s && s !== "<null>" ? s : undefined;
      };
      return [{ id, name: d("name") ?? `Sprint ${id}`, state: (d("state") ?? "future").toLowerCase(), goal: d("goal"), startDate: d("startDate"), endDate: d("endDate"), completeDate: d("completeDate") }];
    }
    return [];
  });
}

/** The issue's epic: a parent one level up (team-managed and newer company-managed),
 *  or the old Epic Link field. */
export function epicIdOf(issue: JiraIssue, epicLinkField: string | null, epicKeyToId: (key: string) => string | undefined): string | null {
  const p = issue.fields.parent;
  if (p && !issue.fields.issuetype?.subtask) return p.id;
  if (epicLinkField) {
    const v = issue.fields[epicLinkField];
    if (typeof v === "string") return epicKeyToId(v) ?? null;
  }
  return null;
}

/** "PROJ-123" → 123. */
export function issueNumber(key: string): number | null {
  const m = /-(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** Tavoro's board key prefix rule (actions/boards.ts): 2–8 letters/digits, starting with a letter. */
export const PREFIX_RE = /^[A-Z][A-Z0-9]{1,7}$/;

/** A Tavoro board key prefix from a Jira project key (Jira allows up to 10 characters). */
export function prefixFrom(key: string): string {
  let p = key.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]/.test(p)) p = `J${p}`;
  if (p.length < 2) p = `${p}J`;
  return p.slice(0, 8);
}
