// Card query → Prisma `where` (docs/JIRA-PARITY.md, phase 7). Names (statuses, people,
// labels, sprints…) are resolved against the workspace data passed in `ctx`, so this
// stays pure and testable (compile.test.ts). Visibility is NOT applied here: run.ts
// always ANDs the caller's board-visibility filter onto whatever this returns.
import type { Prisma } from "../../generated/prisma/client";
import { parseQuery, QueryError, type Node, type Op, type Order, type Value } from "./parse";

export type QueryCtx = {
  me: string;
  now: Date;
  statuses: { id: string; name: string; category: string }[];
  labels: { id: string; name: string }[];
  members: { id: string; name: string | null; email: string }[];
  sprints: { id: string; name: string; status: string }[];
  boards: { id: string; name: string; prefix: string | null }[];
  projects: { id: string; name: string }[];
  epics: { id: string; title: string; key: string | null }[];
  /** "SEC-12" → card id (current or old keys). Unknown keys are left out. */
  cardIdsForKeys: (keys: string[]) => Promise<Map<string, string>>;
  /** Cards blocked by an unfinished card. */
  blockedIds: () => Promise<string[]>;
  /** Custom card fields, queried by name: "Audience" = Managers. */
  customFields?: { id: string; name: string; type: string; options: { id: string; label: string }[] }[];
};

type W = Prisma.CardWhereInput;
type Str = Extract<Value, { kind: "str" }>;

/** What the Cards page shows first: open work, most recently changed first. */
export const DEFAULT_QUERY = "done = false ORDER BY updated DESC";

export const PRIORITY_ORDER = ["highest", "high", "medium", "low", "lowest"] as const;
export const TYPES = ["task", "bug", "story", "epic"] as const;
const CATEGORY: Record<string, string> = { todo: "todo", "to do": "todo", new: "todo", active: "active", "in progress": "active", indeterminate: "active", done: "done", complete: "done", completed: "done" };

/** Fields people can query, with a hint for the query bar. */
export const FIELDS: { name: string; aliases?: string[]; hint: string; ops: Op[] }[] = [
  { name: "text", hint: "title or description contains", ops: ["~", "!~"] },
  { name: "title", aliases: ["summary"], hint: "the card title", ops: ["~", "!~", "=", "!="] },
  { name: "key", aliases: ["issuekey", "id"], hint: "a card key, e.g. SEC-12", ops: ["=", "!=", "in", "not in"] },
  { name: "type", aliases: ["issuetype"], hint: "task, story, bug or epic", ops: ["=", "!=", "in", "not in"] },
  { name: "status", hint: "a status name", ops: ["=", "!=", "in", "not in"] },
  { name: "category", aliases: ["statuscategory"], hint: "todo, active or done", ops: ["=", "!=", "in", "not in"] },
  { name: "priority", hint: "highest … lowest; > means higher", ops: ["=", "!=", "in", "not in", ">", ">=", "<", "<=", "is", "is not"] },
  { name: "estimate", aliases: ["points", "storypoints"], hint: "a number", ops: ["=", "!=", ">", ">=", "<", "<=", "is", "is not"] },
  { name: "assignee", hint: "me, a name or an email", ops: ["=", "!=", "in", "not in", "is", "is not"] },
  { name: "sme", hint: "me, a name or an email", ops: ["=", "!=", "in", "not in", "is", "is not"] },
  { name: "watcher", hint: "me, a name or an email", ops: ["=", "!=", "in", "not in", "is", "is not"] },
  { name: "labels", aliases: ["label"], hint: "a label name", ops: ["=", "!=", "in", "not in", "is", "is not"] },
  { name: "epic", aliases: ["parent"], hint: "an epic's key or title", ops: ["=", "!=", "in", "not in", "is", "is not"] },
  { name: "sprint", hint: "a sprint name, active, planned or completed", ops: ["=", "!=", "in", "not in", "is", "is not"] },
  { name: "board", hint: "a board name or key prefix", ops: ["=", "!=", "in", "not in"] },
  { name: "project", hint: "a project name", ops: ["=", "!=", "in", "not in", "is", "is not"] },
  { name: "due", aliases: ["duedate"], hint: "a date: 2026-12-01, today, 7d, -2w", ops: ["=", "!=", ">", ">=", "<", "<=", "is", "is not"] },
  { name: "start", aliases: ["startdate"], hint: "a date", ops: ["=", "!=", ">", ">=", "<", "<=", "is", "is not"] },
  { name: "created", hint: "a date", ops: ["=", "!=", ">", ">=", "<", "<="] },
  { name: "updated", hint: "a date", ops: ["=", "!=", ">", ">=", "<", "<="] },
  { name: "blocked", hint: "true or false", ops: ["=", "!="] },
  { name: "done", aliases: ["resolved"], hint: "true or false", ops: ["=", "!="] },
];

export const ORDER_FIELDS = ["rank", "key", "title", "created", "updated", "due", "start", "priority", "estimate", "status", "type"] as const;
export type OrderField = (typeof ORDER_FIELDS)[number];

const fieldByName = new Map<string, (typeof FIELDS)[number]>();
for (const f of FIELDS) for (const n of [f.name, ...(f.aliases ?? [])]) fieldByName.set(n, f);

const lc = (s: string) => s.trim().toLowerCase();
const list = (v: Value): Str[] => (v.kind === "list" ? v.items : v.kind === "str" ? [v] : []);
const quote = (s: string) => `“${s}”`;
const some = (names: string[], max = 8) => names.slice(0, max).join(", ") + (names.length > max ? "…" : "");

export async function compileQuery(src: string, ctx: QueryCtx): Promise<{ where: W; order: { field: OrderField; desc: boolean }[] }> {
  const q = parseQuery(src);
  const where = q.where ? await node(q.where, ctx) : {};
  const order = q.order.map((o: Order) => {
    const f = o.field === "points" ? "estimate" : o.field === "duedate" ? "due" : o.field;
    if (!(ORDER_FIELDS as readonly string[]).includes(f)) throw new QueryError(`Can’t sort by ${o.field}. Sort by: ${ORDER_FIELDS.join(", ")}.`, o.pos, o.end);
    return { field: f as OrderField, desc: o.desc };
  });
  return { where, order };
}

async function node(n: Node, ctx: QueryCtx): Promise<W> {
  if (n.kind === "and") return { AND: [await node(n.a, ctx), await node(n.b, ctx)] };
  if (n.kind === "or") return { OR: [await node(n.a, ctx), await node(n.b, ctx)] };
  if (n.kind === "not") return { NOT: await node(n.x, ctx) };
  const f = fieldByName.get(n.field);
  if (!f) {
    const cf = ctx.customFields?.find((x) => x.name.toLowerCase() === n.field);
    if (cf) return custom(cf, n.op, n.value, ctx, n.fieldPos);
    throw new QueryError(`There’s no field called ${n.field}. Try: ${[...FIELDS.map((x) => x.name), ...(ctx.customFields ?? []).map((x) => `"${x.name}"`)].join(", ")}.`, n.fieldPos, n.fieldEnd);
  }
  if (!f.ops.includes(n.op)) throw new QueryError(`${f.name} can’t use “${n.op}”. It takes ${f.ops.join(", ")}.`, n.fieldPos, n.value.end);
  return cmp(f.name, n.op, n.value, ctx);
}

/** Resolve values to ids, with a helpful error for the first one that doesn't match. */
function resolve<T>(vals: Str[], find: (s: string) => T[], what: string, known: () => string[]): T[] {
  const out: T[] = [];
  for (const v of vals) {
    const hit = find(lc(v.v));
    if (!hit.length) throw new QueryError(`No ${what} ${quote(v.v)}. ${known().length ? `Try: ${some(known())}.` : ""}`.trim(), v.pos, v.end);
    out.push(...hit);
  }
  return out;
}

/** `rel` is a card's to-many relation through a join row with `key`. */
function many(rel: "assignees" | "smes" | "watchers" | "labels", key: "userId" | "labelId", op: Op, ids: string[] | null): W {
  if (op === "is") return { [rel]: { none: {} } };
  if (op === "is not") return { [rel]: { some: {} } };
  const has = { [rel]: { some: { [key]: { in: ids! } } } };
  return op === "=" || op === "in" ? has : { [rel]: { none: { [key]: { in: ids! } } } };
}

/** A to-one id column. "!=" and "not in" also leave out cards with no value, like Jira. */
function one(column: (ids: string[] | null) => W, op: Op, ids: string[] | null, isEmpty: W): W {
  if (op === "is") return isEmpty;
  if (op === "is not") return { NOT: isEmpty };
  return op === "=" || op === "in" ? column(ids) : { AND: [{ NOT: isEmpty }, { NOT: column(ids) }] };
}

function people(vals: Str[], ctx: QueryCtx): string[] {
  return vals.map((v) => {
    const s = lc(v.v);
    if (s === "me" || s === "currentuser()") return ctx.me;
    const byEmail = ctx.members.find((m) => m.email.toLowerCase() === s);
    if (byEmail) return byEmail.id;
    const byName = ctx.members.filter((m) => (m.name ?? "").toLowerCase() === s);
    if (byName.length === 1) return byName[0].id;
    if (byName.length > 1) throw new QueryError(`Two members are called ${quote(v.v)}; use their email.`, v.pos, v.end);
    throw new QueryError(`No member ${quote(v.v)}. Use me, a name or an email.`, v.pos, v.end);
  });
}

const DAY = 86_400_000;
function day(v: Str, now: Date): Date {
  const s = lc(v.v);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (s === "today" || s === "now" || s === "now()") return new Date(today);
  if (s === "yesterday") return new Date(today - DAY);
  if (s === "tomorrow") return new Date(today + DAY);
  const rel = /^([+-]?)(\d{1,4})([dwm])$/.exec(s);
  if (rel) {
    const n = Number(rel[2]) * (rel[1] === "-" ? -1 : 1);
    if (rel[3] === "m") {
      const d = new Date(today);
      d.setUTCMonth(d.getUTCMonth() + n);
      return d;
    }
    return new Date(today + n * (rel[3] === "w" ? 7 : 1) * DAY);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new QueryError(`${quote(v.v)} isn’t a date. Use 2026-12-01, today, 7d (in a week) or -2w (two weeks ago).`, v.pos, v.end);
}

function dates(col: "dueDate" | "startDate" | "createdAt" | "updatedAt", op: Op, v: Value, now: Date): W {
  if (op === "is") return { [col]: null };
  if (op === "is not") return { [col]: { not: null } };
  const d = day(v as Str, now);
  const next = new Date(d.getTime() + DAY);
  switch (op) {
    case "=":
      return { [col]: { gte: d, lt: next } };
    case "!=":
      return { NOT: { [col]: { gte: d, lt: next } }, [col]: { not: null } };
    case ">":
      return { [col]: { gte: next } };
    case ">=":
      return { [col]: { gte: d } };
    case "<":
      return { [col]: { lt: d } };
    default:
      return { [col]: { lt: next } };
  }
}

function bool(v: Value): boolean {
  const s = v.kind === "str" ? lc(v.v) : "";
  if (["true", "yes", "1"].includes(s)) return true;
  if (["false", "no", "0"].includes(s)) return false;
  throw new QueryError("Use true or false.", v.pos, v.end);
}

async function cmp(field: string, op: Op, v: Value, ctx: QueryCtx): Promise<W> {
  const vals = list(v);
  const empty = op === "is" || op === "is not";
  switch (field) {
    case "text": {
      const s = (v as Str).v;
      const m: W = { OR: [{ title: { contains: s, mode: "insensitive" } }, { description: { contains: s, mode: "insensitive" } }] };
      return op === "~" ? m : { NOT: m };
    }
    case "title": {
      const s = (v as Str).v;
      if (op === "~") return { title: { contains: s, mode: "insensitive" } };
      if (op === "!~") return { NOT: { title: { contains: s, mode: "insensitive" } } };
      if (op === "=") return { title: { equals: s, mode: "insensitive" } };
      return { NOT: { title: { equals: s, mode: "insensitive" } } };
    }
    case "key": {
      const keys = vals.map((x) => x.v.toUpperCase());
      const map = await ctx.cardIdsForKeys(keys);
      const missing = vals.find((x) => !map.has(x.v.toUpperCase()));
      if (missing && (op === "=" || op === "in") && map.size === 0) throw new QueryError(`No card ${quote(missing.v)} that you can see.`, missing.pos, missing.end);
      const ids = [...map.values()];
      return op === "=" || op === "in" ? { id: { in: ids } } : { id: { notIn: ids } };
    }
    case "type": {
      const ts = resolve(vals, (s) => (TYPES as readonly string[]).filter((t) => t === s || `${t}s` === s), "type", () => [...TYPES]);
      return op === "=" || op === "in" ? { type: { in: ts } } : { type: { notIn: ts } };
    }
    case "status": {
      const ids = resolve(vals, (s) => ctx.statuses.filter((x) => x.name.toLowerCase() === s).map((x) => x.id), "status", () => ctx.statuses.map((x) => x.name));
      return one((i) => ({ statusId: { in: i! } }), op, ids, { statusId: null });
    }
    case "category": {
      const cats = resolve(vals, (s) => (CATEGORY[s] ? [CATEGORY[s]] : []), "status category", () => ["todo", "active", "done"]);
      const m: W = { status: { category: { in: cats } } };
      return op === "=" || op === "in" ? m : { NOT: m };
    }
    case "priority": {
      if (empty) return { priority: op === "is" ? null : { not: null } };
      const ps = resolve(vals, (s) => ((PRIORITY_ORDER as readonly string[]).includes(s) ? [s] : []), "priority", () => [...PRIORITY_ORDER]);
      const idx = PRIORITY_ORDER.indexOf(ps[0] as (typeof PRIORITY_ORDER)[number]);
      const range = (pred: (i: number) => boolean) => ({ priority: { in: PRIORITY_ORDER.filter((_, i) => pred(i)) as string[] } });
      switch (op) {
        case ">":
          return range((i) => i < idx);
        case ">=":
          return range((i) => i <= idx);
        case "<":
          return range((i) => i > idx);
        case "<=":
          return range((i) => i >= idx);
        case "=":
        case "in":
          return { priority: { in: ps } };
        default:
          return { priority: { notIn: ps } };
      }
    }
    case "estimate": {
      if (empty) return { estimate: op === "is" ? null : { not: null } };
      const n = Number((v as Str).v);
      if (!Number.isFinite(n)) throw new QueryError("Use a number.", v.pos, v.end);
      const m = { "=": { equals: n }, "!=": { not: n }, ">": { gt: n }, ">=": { gte: n }, "<": { lt: n }, "<=": { lte: n } }[op as "="];
      return { estimate: m };
    }
    case "assignee":
      return many("assignees", "userId", op, empty ? null : people(vals, ctx));
    case "sme":
      return many("smes", "userId", op, empty ? null : people(vals, ctx));
    case "watcher":
      return many("watchers", "userId", op, empty ? null : people(vals, ctx));
    case "labels": {
      const ids = empty ? null : resolve(vals, (s) => ctx.labels.filter((l) => l.name.toLowerCase() === s).map((l) => l.id), "label", () => ctx.labels.map((l) => l.name));
      return many("labels", "labelId", op, ids);
    }
    case "epic": {
      const ids = empty
        ? null
        : resolve(vals, (s) => ctx.epics.filter((e) => e.key?.toLowerCase() === s || e.title.toLowerCase() === s).map((e) => e.id), "epic", () => ctx.epics.map((e) => e.key ?? e.title));
      return one((i) => ({ epicId: { in: i! } }), op, ids, { epicId: null });
    }
    case "sprint": {
      const ids = empty
        ? null
        : resolve(
            vals,
            (s) => {
              const named = ctx.sprints.filter((x) => x.name.toLowerCase() === s || x.id === s);
              if (named.length) return named.map((x) => x.id);
              const state = s === "active" || s === "opensprints()" ? "active" : s === "planned" || s === "future" || s === "futuresprints()" ? "planned" : s === "completed" || s === "closed" || s === "closedsprints()" ? "completed" : null;
              return state ? ctx.sprints.filter((x) => x.status === state).map((x) => x.id).concat(ctx.sprints.some((x) => x.status === state) ? [] : ["__none__"]) : [];
            },
            "sprint",
            () => [...ctx.sprints.map((x) => x.name), "active", "planned", "completed"],
          );
      return one((i) => ({ sprintId: { in: i! } }), op, ids, { sprintId: null });
    }
    case "board": {
      const ids = resolve(vals, (s) => ctx.boards.filter((b) => b.name.toLowerCase() === s || b.prefix?.toLowerCase() === s).map((b) => b.id), "board", () => ctx.boards.map((b) => b.prefix ?? b.name));
      const m: W = { column: { boardId: { in: ids } } };
      return op === "=" || op === "in" ? m : { NOT: m };
    }
    case "project": {
      const isEmpty: W = { column: { board: { projectId: null } } };
      const ids = empty ? null : resolve(vals, (s) => ctx.projects.filter((p) => p.name.toLowerCase() === s).map((p) => p.id), "project", () => ctx.projects.map((p) => p.name));
      return one((i) => ({ column: { board: { projectId: { in: i! } } } }), op, ids, isEmpty);
    }
    case "due":
      return dates("dueDate", op, v, ctx.now);
    case "start":
      return dates("startDate", op, v, ctx.now);
    case "created":
      return dates("createdAt", op, v, ctx.now);
    case "updated":
      return dates("updatedAt", op, v, ctx.now);
    case "blocked": {
      const want = bool(v) === (op === "=");
      const ids = await ctx.blockedIds();
      return want ? { id: { in: ids } } : { id: { notIn: ids } };
    }
    case "done": {
      const want = bool(v) === (op === "=");
      const m: W = { status: { category: "done" } };
      return want ? m : { NOT: m };
    }
  }
  throw new QueryError(`There’s no field called ${field}.`, 0);
}

const CUSTOM_OPS: Record<string, Op[]> = {
  text: ["=", "!=", "~", "!~", "is", "is not"],
  number: ["=", "!=", ">", ">=", "<", "<=", "is", "is not"],
  date: ["=", "!=", ">", ">=", "<", "<=", "is", "is not"],
  checkbox: ["=", "!=", "is", "is not"],
  select: ["=", "!=", "in", "not in", "is", "is not"],
  multiselect: ["=", "!=", "in", "not in", "is", "is not"],
  person: ["=", "!=", "in", "not in", "is", "is not"],
};

/** A custom field: a condition on the card's value row for it. */
function custom(cf: NonNullable<QueryCtx["customFields"]>[number], op: Op, v: Value, ctx: QueryCtx, pos: number): W {
  const ops = CUSTOM_OPS[cf.type] ?? [];
  if (!ops.includes(op)) throw new QueryError(`“${cf.name}” can’t use “${op}”. It takes ${ops.join(", ")}.`, pos, v.end);
  type V = Prisma.CardFieldValueWhereInput;
  const has = (cond: V): W => ({ fieldValues: { some: { fieldId: cf.id, ...cond } } });
  const filled: V =
    cf.type === "text" ? { text: { not: null } } : cf.type === "number" ? { number: { not: null } } : cf.type === "date" ? { date: { not: null } } : cf.type === "checkbox" ? { bool: { not: null } } : cf.type === "person" ? { userId: { not: null } } : { NOT: { optionIds: { isEmpty: true } } };
  if (op === "is") return { NOT: has(filled) };
  if (op === "is not") return has(filled);
  const vals = list(v);
  const neg = op === "!=" || op === "!~" || op === "not in";
  let cond: V;
  switch (cf.type) {
    case "text": {
      const s = (v as Str).v;
      cond = op === "~" || op === "!~" ? { text: { contains: s, mode: "insensitive" } } : { text: { equals: s, mode: "insensitive" } };
      break;
    }
    case "number": {
      const n = Number((v as Str).v);
      if (!Number.isFinite(n)) throw new QueryError("Use a number.", v.pos, v.end);
      cond = { number: { "=": { equals: n }, "!=": { equals: n }, ">": { gt: n }, ">=": { gte: n }, "<": { lt: n }, "<=": { lte: n } }[op as "="] };
      break;
    }
    case "date": {
      const d = day(v as Str, ctx.now);
      const next = new Date(d.getTime() + DAY);
      cond = { date: { "=": { gte: d, lt: next }, "!=": { gte: d, lt: next }, ">": { gte: next }, ">=": { gte: d }, "<": { lt: d }, "<=": { lt: next } }[op as "="] };
      break;
    }
    case "checkbox": {
      cond = { bool: bool(v) };
      break;
    }
    case "person": {
      cond = { userId: { in: people(vals, ctx) } };
      break;
    }
    default: {
      const ids = resolve(vals, (s) => cf.options.filter((o) => o.label.toLowerCase() === s).map((o) => o.id), `option of “${cf.name}”`, () => cf.options.map((o) => o.label));
      cond = { optionIds: { hasSome: ids } };
    }
  }
  // "!=" leaves out cards with no value, like the built-in fields.
  return neg ? { AND: [has(filled), { NOT: has(cond) }] } : has(cond);
}
