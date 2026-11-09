// Query bar suggestions (docs/JIRA-PARITY.md, phase 7): from the text before the caret,
// work out whether a field, an operator, a value or a keyword comes next, and offer
// matches. Pure; unit-tested in query.test.ts.
import { FIELDS, ORDER_FIELDS, PRIORITY_ORDER, TYPES } from "./compile";

export type SuggestData = {
  statuses: { name: string }[];
  labels: { name: string }[];
  members: { name: string | null; email: string }[];
  sprints: { name: string; status: string }[];
  boards: { name: string; prefix: string | null }[];
  projects: { name: string }[];
  epics: { title: string; key: string | null }[];
};

export type Suggestion = { label: string; insert: string; hint?: string };

const TOKEN = /"[^"]*"?|'[^']*'?|!=|>=|<=|!~|[=<>~(),]|[A-Za-z0-9_\-.:@+/#&]+/g;
const OPS = new Set(["=", "!=", ">", ">=", "<", "<=", "~", "!~"]);
const fieldFor = new Map<string, (typeof FIELDS)[number]>();
for (const f of FIELDS) for (const n of [f.name, ...(f.aliases ?? [])]) fieldFor.set(n, f);

const quoteIfNeeded = (s: string) => (/^[A-Za-z0-9_\-.:@+/#&]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`);

function values(field: string, d: SuggestData): Suggestion[] {
  const v = (label: string, hint?: string): Suggestion => ({ label, insert: quoteIfNeeded(label), hint });
  switch (field) {
    case "type":
      return TYPES.map((t) => v(t));
    case "status":
      return d.statuses.map((s) => v(s.name));
    case "category":
      return ["todo", "active", "done"].map((c) => v(c));
    case "priority":
      return PRIORITY_ORDER.map((p) => v(p));
    case "assignee":
    case "sme":
    case "watcher":
      return [v("me", "you"), ...d.members.map((m) => v(m.name ?? m.email, m.name ? m.email : undefined))];
    case "labels":
      return d.labels.map((l) => v(l.name));
    case "epic":
      return d.epics.map((e) => (e.key ? { label: e.key, insert: e.key, hint: e.title } : v(e.title)));
    case "sprint":
      return [v("active", "running now"), v("planned"), v("completed"), ...d.sprints.map((s) => v(s.name, s.status))];
    case "board":
      return d.boards.map((b) => (b.prefix ? { label: b.prefix, insert: b.prefix, hint: b.name } : v(b.name)));
    case "project":
      return d.projects.map((p) => v(p.name));
    case "due":
    case "start":
    case "created":
    case "updated":
      return [v("today"), v("7d", "a week from today"), v("-7d", "a week ago"), v("-1m", "a month ago")];
    case "blocked":
    case "done":
      return [v("true"), v("false")];
    default:
      return [];
  }
}

export function suggest(text: string, caret: number, d: SuggestData): { from: number; to: number; items: Suggestion[] } {
  const left = text.slice(0, caret);
  const partialMatch = /(?:"[^"]*|'[^']*|[A-Za-z0-9_\-.:@+/#&]*)$/.exec(left);
  const partial = partialMatch ? partialMatch[0] : "";
  const from = caret - partial.length;
  const needle = partial.replace(/^["']/, "").toLowerCase();
  const toks = (left.slice(0, from).match(TOKEN) ?? []).map((t) => t.toLowerCase());
  const last = toks[toks.length - 1];
  const filter = (items: Suggestion[]) =>
    items
      .filter((s) => !needle || s.label.toLowerCase().startsWith(needle) || (needle.length > 1 && s.label.toLowerCase().includes(needle)))
      .slice(0, 12);
  const out = (items: Suggestion[]) => ({ from, to: caret, items: filter(items) });

  const inOrder = toks.includes("order");
  if (inOrder) {
    if (last === "by" || last === ",") return out(ORDER_FIELDS.map((f) => ({ label: f, insert: f })));
    if (last && (ORDER_FIELDS as readonly string[]).includes(last)) return out([{ label: "DESC", insert: "DESC" }, { label: "ASC", insert: "ASC" }, { label: ",", insert: "," }]);
    return out([]);
  }

  // A value: after an operator, or inside an in (…) list.
  let field: string | undefined;
  if (last && OPS.has(last)) field = toks[toks.length - 2];
  else if (last === "(" || last === ",") {
    const i = toks.lastIndexOf("in");
    if (i > 0 && !toks.slice(i).includes(")")) field = toks[i - 1] === "not" ? toks[i - 2] : toks[i - 1];
  } else if (last === "is" || (last === "not" && toks[toks.length - 2] === "is")) {
    return out([{ label: "EMPTY", insert: "EMPTY" }, ...(last === "is" ? [{ label: "NOT EMPTY", insert: "NOT EMPTY" }] : [])]);
  }
  if (field) {
    const f = fieldFor.get(field);
    return out(f ? values(f.name, d) : []);
  }

  // An operator, after a field.
  const f = last ? fieldFor.get(last) : undefined;
  if (f && (toks.length < 2 || !OPS.has(toks[toks.length - 2]))) {
    return out(f.ops.map((o) => ({ label: o === "in" ? "in (…)" : o === "not in" ? "not in (…)" : o === "is" ? "is EMPTY" : o === "is not" ? "is not EMPTY" : o, insert: o === "in" ? "in (" : o === "not in" ? "not in (" : o })));
  }

  // A field, at the start or after AND / OR / NOT / (.
  if (!last || last === "and" || last === "or" || last === "not" || last === "(") {
    return out(FIELDS.map((x) => ({ label: x.name, insert: x.name, hint: x.hint })));
  }

  // After a whole condition.
  return out(["AND", "OR", "ORDER BY"].map((k) => ({ label: k, insert: k })));
}
