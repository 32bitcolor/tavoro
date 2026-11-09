// Runs automation rules (docs/JIRA-PARITY.md, phase 9) on the worker.
//
//   handleEvent  — a card changed (queued by the app): find the rules for it and run them;
//   runScheduled — the daily job: "due in N days" and "every day / every Monday" rules.
//
// A rule's changes are made here, directly, and recorded in the card's History as
// "Automation · <rule>". They're queued as events in turn (one level deeper), so rules
// can chain, up to MAX_DEPTH, and a card gets at most MAX_RUNS_PER_CARD_PER_MINUTE runs.
// Only the "Email people" action sends email; a rule's other changes don't notify.
//
// Relative imports, no "server-only": the worker runs this.
import { generateKeyBetween } from "fractional-indexing";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { appUrl } from "../app-url";
import { EMPTY, asFieldType, asOptions, displayValue, fromStored, toStored } from "../custom-fields";
import { automationNotice, withLink } from "../email-templates";
import { enqueueAutomation, enqueueEmail, type AutomationEvent } from "../queues";
import { compileQuery } from "../query/compile";
import { QueryError } from "../query/parse";
import { workspaceQueryContext } from "../query/context";
import { Action, MAX_DEPTH, MAX_RUNS_PER_CARD_PER_MINUTE, Trigger, eventForActivity, type Action as ActionT } from "./rules";

type Db = PrismaClient;
type Rule = { id: string; workspaceId: string; name: string; boardId: string | null; trigger: unknown; condition: string; actions: unknown; createdById: string | null };
type CardRow = { id: string; title: string; keySeq: number | null; statusId: string | null; columnId: string | null; boardId: string; prefix: string | null; workspaceId: string };

const PRIORITY_LABEL: Record<string, string> = { highest: "Highest", high: "High", medium: "Medium", low: "Low", lowest: "Lowest" };

async function loadCard(db: Db, cardId: string): Promise<CardRow | null> {
  const c = await db.card.findUnique({
    where: { id: cardId },
    select: { id: true, title: true, keySeq: true, statusId: true, columnId: true, column: { select: { boardId: true, board: { select: { workspaceId: true, cardKeyPrefix: true } } } } },
  });
  if (!c?.column) return null; // subtasks aren't automated themselves
  return { id: c.id, title: c.title, keySeq: c.keySeq, statusId: c.statusId, columnId: c.columnId, boardId: c.column.boardId, prefix: c.column.board.cardKeyPrefix, workspaceId: c.column.board.workspaceId };
}

const keyOf = (c: CardRow) => (c.prefix && c.keySeq != null ? `${c.prefix}-${c.keySeq}` : null);

/** Who a rule acts as for "me" in its condition: whoever made it, else an admin. */
async function ruleOwner(db: Db, r: Rule) {
  if (r.createdById) return r.createdById;
  return (await db.membership.findFirst({ where: { workspaceId: r.workspaceId, role: "ADMIN", suspendedAt: null }, select: { userId: true } }))?.userId ?? "";
}

async function matches(db: Db, r: Rule, cardIds: string[]): Promise<string[]> {
  if (!r.condition.trim()) return cardIds;
  const ctx = await workspaceQueryContext(db, r.workspaceId, await ruleOwner(db, r));
  const { where } = await compileQuery(r.condition, ctx);
  const hits = await db.card.findMany({ where: { AND: [{ id: { in: cardIds } }, where] }, select: { id: true } });
  return hits.map((h) => h.id);
}

async function logRun(db: Db, ruleId: string, card: CardRow | null, ok: boolean, message: string) {
  await db.automationRun.create({ data: { ruleId, cardId: card?.id ?? null, cardKey: card ? keyOf(card) : null, ok, message: message.slice(0, 1000) } });
  await db.automationRule.update({ where: { id: ruleId }, data: { lastRunAt: new Date() } });
  // Keep the newest 200.
  const old = await db.automationRun.findMany({ where: { ruleId }, orderBy: { at: "desc" }, skip: 200, select: { id: true } });
  if (old.length) await db.automationRun.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

// ── Actions ──────────────────────────────────────────────────────────────────

// The events a rule run causes, sent once at the end of the run: one per kind of change,
// so a run that removes one label and adds another starts other rules once, not twice.
const pending = new Map<string, Map<string, AutomationEvent>>();

async function activity(db: Db, card: CardRow, rule: Rule, kind: string, data: Record<string, unknown>, depth: number) {
  await db.cardActivity.create({ data: { cardId: card.id, actorId: null, kind, data: { ...data, automation: rule.name } as Prisma.InputJsonValue } });
  const ev = eventForActivity(kind);
  if (!ev) return;
  const key = `${ev.trigger}:${ev.field ?? ""}:${kind === "field" ? String(data.name ?? "") : ""}`;
  const bucket = pending.get(card.id) ?? new Map<string, AutomationEvent>();
  bucket.set(key, { cardId: card.id, trigger: ev.trigger as AutomationEvent["trigger"], field: ev.field, data, depth: depth + 1 });
  pending.set(card.id, bucket);
}

async function flush(cardId: string) {
  const bucket = pending.get(cardId);
  pending.delete(cardId);
  for (const ev of bucket?.values() ?? []) await enqueueAutomation(ev);
}

async function member(db: Db, workspaceId: string, ref: string) {
  const s = ref.trim().toLowerCase();
  const rows = await db.membership.findMany({ where: { workspaceId, suspendedAt: null }, select: { user: { select: { id: true, name: true, email: true } } } });
  const hit = rows.find((m) => m.user.email.toLowerCase() === s) ?? (() => {
    const byName = rows.filter((m) => (m.user.name ?? "").toLowerCase() === s);
    return byName.length === 1 ? byName[0] : undefined;
  })();
  if (!hit) throw new Error(`No member “${ref}”.`);
  return hit.user;
}

async function runAction(db: Db, rule: Rule, card: CardRow, a: ActionT, depth: number): Promise<string> {
  const ws = card.workspaceId;
  switch (a.kind) {
    case "set_status": {
      const st = await db.workspaceStatus.findFirst({ where: { workspaceId: ws, name: { equals: a.status, mode: "insensitive" } }, select: { id: true, name: true } });
      if (!st) throw new Error(`No status “${a.status}”.`);
      if (card.statusId === st.id) return `already ${st.name}`;
      const col = await db.column.findFirst({ where: { boardId: card.boardId, statusId: st.id }, orderBy: { position: "asc" }, select: { id: true } });
      if (!col) throw new Error(`This board has no column for “${st.name}”.`);
      const last = await db.card.findFirst({ where: { columnId: col.id }, orderBy: { position: "desc" }, select: { position: true } });
      const before = card.statusId ? await db.workspaceStatus.findUnique({ where: { id: card.statusId }, select: { name: true } }) : null;
      await db.card.update({ where: { id: card.id }, data: { statusId: st.id, columnId: col.id, position: generateKeyBetween(last?.position ?? null, null) } });
      card.statusId = st.id;
      card.columnId = col.id;
      await activity(db, card, rule, "status", { from: before?.name ?? null, to: st.name }, depth);
      return `moved to ${st.name}`;
    }
    case "assign":
    case "watch": {
      const u = await member(db, ws, a.person);
      if (a.kind === "watch") {
        await db.cardWatcher.createMany({ data: [{ cardId: card.id, userId: u.id }], skipDuplicates: true });
        return `${u.name ?? u.email} watches it`;
      }
      const r = await db.cardAssignee.createMany({ data: [{ cardId: card.id, userId: u.id }], skipDuplicates: true });
      await db.cardWatcher.createMany({ data: [{ cardId: card.id, userId: u.id }], skipDuplicates: true });
      if (r.count) await activity(db, card, rule, "assignee", { added: u.name ?? u.email }, depth);
      return r.count ? `assigned ${u.name ?? u.email}` : `${u.name ?? u.email} was already assigned`;
    }
    case "unassign": {
      const rows = await db.cardAssignee.findMany({ where: { cardId: card.id }, select: { userId: true, user: { select: { name: true, email: true } } } });
      const gone = a.person.trim().toLowerCase() === "everyone" ? rows : rows.filter((r) => r.user.email.toLowerCase() === a.person.trim().toLowerCase() || (r.user.name ?? "").toLowerCase() === a.person.trim().toLowerCase());
      for (const g of gone) {
        await db.cardAssignee.delete({ where: { cardId_userId: { cardId: card.id, userId: g.userId } } });
        await activity(db, card, rule, "assignee", { removed: g.user.name ?? g.user.email }, depth);
      }
      return gone.length ? `unassigned ${gone.map((g) => g.user.name ?? g.user.email).join(", ")}` : "nobody to unassign";
    }
    case "set_priority": {
      const to = a.priority === "none" ? null : a.priority;
      const before = (await db.card.findUnique({ where: { id: card.id }, select: { priority: true } }))?.priority ?? null;
      if (before === to) return "priority unchanged";
      await db.card.update({ where: { id: card.id }, data: { priority: to } });
      await activity(db, card, rule, "priority", { from: before ? PRIORITY_LABEL[before] : null, to: to ? PRIORITY_LABEL[to] : null }, depth);
      return `priority ${to ?? "cleared"}`;
    }
    case "add_label":
    case "remove_label": {
      const l = await db.label.findFirst({ where: { workspaceId: ws, name: { equals: a.label, mode: "insensitive" } }, select: { id: true, name: true } });
      if (!l) throw new Error(`No label “${a.label}”.`);
      if (a.kind === "add_label") {
        const r = await db.cardLabel.createMany({ data: [{ cardId: card.id, labelId: l.id }], skipDuplicates: true });
        if (r.count) await activity(db, card, rule, "label", { added: l.name }, depth);
        return r.count ? `added ${l.name}` : `already had ${l.name}`;
      }
      const r = await db.cardLabel.deleteMany({ where: { cardId: card.id, labelId: l.id } });
      if (r.count) await activity(db, card, rule, "label", { removed: l.name }, depth);
      return r.count ? `removed ${l.name}` : `didn’t have ${l.name}`;
    }
    case "set_field": {
      const f = await db.customField.findFirst({
        where: { workspaceId: ws, name: { equals: a.field, mode: "insensitive" } },
        select: { id: true, name: true, type: true, options: true, allBoards: true, boards: { select: { boardId: true } } },
      });
      if (!f) throw new Error(`No field “${a.field}”.`);
      if (!f.allBoards && !f.boards.some((b) => b.boardId === card.boardId)) throw new Error(`“${f.name}” isn’t used on this board.`);
      const def = { type: asFieldType(f.type), options: asOptions(f.options) };
      let value: string | null = a.value || null;
      if (def.type === "person" && value) value = (await member(db, ws, value)).id;
      const stored = toStored(def, def.type === "multiselect" && value ? value.split(",").map((x) => x.trim()) : value);
      if ("error" in stored) throw new Error(`${f.name}: ${stored.error}`);
      const before = await db.cardFieldValue.findUnique({ where: { cardId_fieldId: { cardId: card.id, fieldId: f.id } } });
      if (stored.ok) await db.cardFieldValue.upsert({ where: { cardId_fieldId: { cardId: card.id, fieldId: f.id } }, create: { cardId: card.id, fieldId: f.id, ...stored.ok }, update: { ...EMPTY, ...stored.ok } });
      else if (before) await db.cardFieldValue.delete({ where: { cardId_fieldId: { cardId: card.id, fieldId: f.id } } });
      const show = (v: ReturnType<typeof fromStored>) => (def.type === "person" ? (v ? "someone" : null) : displayValue(def, v));
      const from = show(fromStored(def, before));
      const to = show(stored.ok ? fromStored(def, stored.ok) : null);
      if (from !== to) await activity(db, card, rule, "field", { name: f.name, from, to }, depth);
      return `${f.name} ${to ?? "cleared"}`;
    }
    case "set_due": {
      const before = (await db.card.findUnique({ where: { id: card.id }, select: { dueDate: true } }))?.dueDate ?? null;
      const now = new Date();
      const due = a.days === null ? null : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + a.days, 17));
      await db.card.update({ where: { id: card.id }, data: { dueDate: due } });
      const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
      if (ymd(before) !== ymd(due)) await activity(db, card, rule, "due", { from: ymd(before), to: ymd(due) }, depth);
      return due ? `due ${ymd(due)}` : "due date cleared";
    }
    case "add_comment": {
      const author = await ruleOwner(db, rule);
      if (!author) throw new Error("No one to post the comment as.");
      const body = JSON.stringify({ type: "doc", content: a.text.split(/\n{2,}/).map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) });
      await db.comment.create({ data: { cardId: card.id, authorId: author, body, automation: true, importedAuthor: rule.name } });
      await enqueueAutomation({ cardId: card.id, trigger: "comment_added", depth: depth + 1 });
      return "commented";
    }
    case "add_subtask": {
      const last = await db.card.findFirst({ where: { parentCardId: card.id }, orderBy: { position: "desc" }, select: { position: true } });
      let keySeq: number | null = null;
      if (card.prefix) keySeq = (await db.board.update({ where: { id: card.boardId }, data: { cardKeySeq: { increment: 1 } }, select: { cardKeySeq: true } })).cardKeySeq;
      await db.card.create({ data: { parentCardId: card.id, title: a.title, position: generateKeyBetween(last?.position ?? null, null), keySeq } });
      await activity(db, card, rule, "subtask", { added: a.title }, depth);
      return `added the subtask “${a.title}”`;
    }
    case "notify": {
      let to: { email: string }[] = [];
      if (a.to === "person") to = [await member(db, ws, a.person)];
      else if (a.to === "assignees") to = (await db.cardAssignee.findMany({ where: { cardId: card.id }, select: { user: { select: { email: true } } } })).map((x) => x.user);
      else to = (await db.cardWatcher.findMany({ where: { cardId: card.id }, select: { user: { select: { email: true } } } })).map((x) => x.user);
      const msg = withLink(automationNotice({ ruleName: rule.name, cardTitle: card.title, cardKey: keyOf(card), message: a.message }), appUrl(`/boards/${card.boardId}?card=${card.id}`));
      for (const u of to) await enqueueEmail({ to: u.email, ...msg });
      return to.length ? `emailed ${to.length} ${to.length === 1 ? "person" : "people"}` : "nobody to email";
    }
  }
}

async function runRule(db: Db, rule: Rule, card: CardRow, depth: number) {
  const parsed = (Array.isArray(rule.actions) ? rule.actions : []).map((x) => Action.safeParse(x));
  const done: string[] = [];
  try {
    for (const p of parsed) {
      if (!p.success) throw new Error("An action is invalid; edit the rule.");
      done.push(await runAction(db, rule, card, p.data, depth));
    }
    await logRun(db, rule.id, card, true, done.join("; ") || "nothing to do");
  } catch (e) {
    await logRun(db, rule.id, card, false, [...done, `stopped: ${(e as Error).message}`].join("; "));
  }
}

async function tooBusy(db: Db, cardId: string) {
  const n = await db.automationRun.count({ where: { cardId, ok: true, at: { gt: new Date(Date.now() - 60_000) } } });
  return n >= MAX_RUNS_PER_CARD_PER_MINUTE;
}

/** Log why a run was stopped, once per rule and card per minute (the log isn't a loop of its own). */
async function logStopped(db: Db, rule: Rule, card: CardRow, message: string) {
  const recent = await db.automationRun.findFirst({ where: { ruleId: rule.id, cardId: card.id, ok: false, message, at: { gt: new Date(Date.now() - 60_000) } }, select: { id: true } });
  if (!recent) await logRun(db, rule.id, card, false, message);
}

// ── Entry points ─────────────────────────────────────────────────────────────

export async function handleEvent(db: Db, ev: AutomationEvent) {
  const card = await loadCard(db, ev.cardId);
  if (!card) return { ran: 0 };
  const rules = (await db.automationRule.findMany({ where: { workspaceId: card.workspaceId, enabled: true } })) as Rule[];
  const eligible: Rule[] = [];
  for (const r of rules) {
    if (r.boardId && r.boardId !== card.boardId) continue;
    const t = Trigger.safeParse(r.trigger);
    if (!t.success || t.data.kind !== ev.trigger) continue;
    if (t.data.kind === "status_changed" && t.data.to && String(ev.data?.to ?? "").toLowerCase() !== t.data.to.toLowerCase()) continue;
    if (t.data.kind === "field_changed") {
      if (t.data.field !== ev.field) continue;
      if (t.data.field === "custom" && String(ev.data?.name ?? "").toLowerCase() !== t.data.custom.toLowerCase()) continue;
    }
    if (t.data.kind === "subtasks_done") {
      const subs = await db.card.findMany({ where: { parentCardId: card.id }, select: { done: true } });
      if (!subs.length || subs.some((s) => !s.done)) continue;
    }
    try {
      if (!(await matches(db, r, [card.id])).length) continue;
    } catch (e) {
      await logStopped(db, r, card, `the condition doesn’t work: ${e instanceof QueryError ? e.message : (e as Error).message}`);
      continue;
    }
    eligible.push(r);
  }
  // Every rule sees the card as the event left it: which rules run is decided before
  // any of them changes it (like Jira), so one rule's changes don't pull another rule
  // into the same event.
  let ran = 0;
  for (const r of eligible) {
    if (ev.depth > MAX_DEPTH) {
      await logStopped(db, r, card, `stopped: rules triggered each other more than ${MAX_DEPTH} times in a row`);
      continue;
    }
    if (await tooBusy(db, card.id)) {
      await logStopped(db, r, card, `stopped: more than ${MAX_RUNS_PER_CARD_PER_MINUTE} rule runs on this card in a minute`);
      continue;
    }
    await runRule(db, r, card, ev.depth);
    ran++;
  }
  // What the runs changed goes out once, as the next level of events.
  await flush(card.id);
  return { ran };
}

/** The daily job (07:00 UTC): due-soon rules, and daily / Monday scheduled rules. */
export async function runScheduled(db: Db, now = new Date()) {
  const rules = (await db.automationRule.findMany({ where: { enabled: true } })) as Rule[];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let ran = 0;
  for (const r of rules) {
    const t = Trigger.safeParse(r.trigger);
    if (!t.success) continue;
    let where: Prisma.CardWhereInput | null = null;
    if (t.data.kind === "due_soon") {
      const from = new Date(today + t.data.days * 86_400_000);
      where = { dueDate: { gte: from, lt: new Date(from.getTime() + 86_400_000) }, NOT: { status: { category: "done" } } };
    } else if (t.data.kind === "schedule" && (t.data.every === "day" || now.getUTCDay() === 1)) {
      if (!r.condition.trim()) {
        await logRun(db, r.id, null, false, "A scheduled rule needs a condition, so it doesn’t change every card.");
        continue;
      }
      where = {};
    } else continue;
    const cards = await db.card.findMany({
      where: { ...where, columnId: { not: null }, column: { board: { workspaceId: r.workspaceId, ...(r.boardId ? { id: r.boardId } : {}) } } },
      select: { id: true },
      take: 500,
    });
    let ids: string[];
    try {
      ids = (await matches(db, r, cards.map((c) => c.id))).slice(0, 200);
    } catch (e) {
      await logRun(db, r.id, null, false, `the condition doesn’t work: ${(e as Error).message}`);
      continue;
    }
    for (const id of ids) {
      const card = await loadCard(db, id);
      if (!card || (await tooBusy(db, id))) continue;
      await runRule(db, r, card, 0);
      await flush(card.id);
      ran++;
    }
  }
  return { ran };
}
