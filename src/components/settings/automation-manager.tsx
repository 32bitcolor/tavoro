"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, ChevronRight, Pencil, Plus, Trash2, X, XCircle, Zap } from "lucide-react";

import { deleteAutomationRule, getAutomationRuns, previewAutomationCondition, saveAutomationRule, setAutomationRuleEnabled } from "@/app/actions/automation";
import { ConfirmDelete } from "@/components/shared/confirm-delete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ACTION_LABEL, TRIGGER_LABEL, TRIGGERS, WATCHED_FIELDS, describeRule, type Action, type ActionKind, type Trigger } from "@/lib/automation/rules";
import { cn } from "@/lib/utils";

// Settings → Automation (docs/JIRA-PARITY.md, phase 9): "When … if … then …" rules.

type RuleRow = {
  id: string;
  name: string;
  enabled: boolean;
  boardId: string | null;
  trigger: Trigger;
  condition: string;
  actions: Action[];
  lastRunAt: string | null;
  lastOk: boolean | null;
};
type Data = {
  boards: { id: string; name: string }[];
  statuses: { name: string }[];
  labels: { name: string }[];
  members: { name: string | null; email: string }[];
  fields: { name: string; type: string; options: string[] }[];
};
type Draft = { id: string | null; name: string; enabled: boolean; boardId: string | null; trigger: Trigger; condition: string; actions: Action[] };

const blankAction = (kind: ActionKind, d: Data): Action => {
  switch (kind) {
    case "set_status":
      return { kind, status: d.statuses[0]?.name ?? "" };
    case "assign":
    case "watch":
      return { kind, person: d.members[0]?.email ?? "" };
    case "unassign":
      return { kind, person: "everyone" };
    case "set_priority":
      return { kind, priority: "high" };
    case "add_label":
    case "remove_label":
      return { kind, label: d.labels[0]?.name ?? "" };
    case "set_field":
      return { kind, field: d.fields[0]?.name ?? "", value: "" };
    case "set_due":
      return { kind, days: 7 };
    case "add_comment":
      return { kind, text: "" };
    case "add_subtask":
      return { kind, title: "" };
    case "notify":
      return { kind, to: "assignees", person: "", message: "" };
  }
};
const blankTrigger = (kind: Trigger["kind"]): Trigger => {
  switch (kind) {
    case "status_changed":
      return { kind, to: "" };
    case "field_changed":
      return { kind, field: "assignee", custom: "" };
    case "due_soon":
      return { kind, days: 1 };
    case "schedule":
      return { kind, every: "day" };
    default:
      return { kind } as Trigger;
  }
};

export function AutomationManager({ rules, data }: { rules: RuleRow[]; data: Data }) {
  const router = useRouter();
  // On/off flips at once; the server catches up.
  const [enabledOverride, setEnabledOverride] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openRuns, setOpenRuns] = useState<string | null>(null);
  // null while loading, so one rule's runs never show under another.
  const [runs, setRuns] = useState<{ id: string; cardId: string | null; cardKey: string | null; ok: boolean; message: string; at: string }[] | null>(null);

  async function showRuns(id: string) {
    if (openRuns === id) return setOpenRuns(null);
    setOpenRuns(id);
    setRuns(null);
    setRuns((await getAutomationRuns(id)).runs);
  }

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">Automation</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Rules that do routine work: <em>when</em> something happens to a card, <em>if</em> it matches a query, <em>then</em> change it or tell someone.
          Rules run in the background a moment after the change, and each card&rsquo;s History shows what they did.
        </p>
      </div>

      {rules.length === 0 && !draft && <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No rules yet.</p>}

      <ul className="flex flex-col gap-3">
        {rules.map((r) => (
          <li key={r.id} className={cn("rounded-lg border border-border p-4", !(enabledOverride[r.id] ?? r.enabled) && "opacity-70")}>
            <div className="flex flex-wrap items-center gap-2">
              <Zap className="size-4 text-accent" aria-hidden="true" />
              <h3 className="font-medium">{r.name}</h3>
              {!(enabledOverride[r.id] ?? r.enabled) && <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">Off</span>}
              <span className="flex-1" />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={enabledOverride[r.id] ?? r.enabled}
                  onChange={async (e) => {
                    const on = e.target.checked;
                    setEnabledOverride((o) => ({ ...o, [r.id]: on }));
                    await setAutomationRuleEnabled(r.id, on);
                    router.refresh();
                  }}
                  className="size-4 accent-[var(--accent)]"
                />
                On
              </label>
              <Button variant="ghost" size="icon-xs" aria-label={`Edit ${r.name}`} onClick={() => setDraft({ id: r.id, name: r.name, enabled: r.enabled, boardId: r.boardId, trigger: r.trigger, condition: r.condition, actions: r.actions })}>
                <Pencil className="size-3.5" />
              </Button>
              <ConfirmDelete
                title={`Delete the rule “${r.name}”?`}
                description="It stops running. What it already changed stays."
                confirmLabel="Delete rule"
                onConfirm={async () => {
                  await deleteAutomationRule(r.id);
                  router.refresh();
                }}
                trigger={
                  <Button variant="ghost" size="icon-xs" aria-label={`Delete ${r.name}`} className="text-muted-foreground hover:text-destructive-ink">
                    <Trash2 className="size-3.5" />
                  </Button>
                }
              />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {describeRule(r)}
              {r.boardId && <> On {data.boards.find((b) => b.id === r.boardId)?.name ?? "one board"} only.</>}
            </p>
            <button type="button" onClick={() => showRuns(r.id)} aria-expanded={openRuns === r.id} className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              {openRuns === r.id ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
              {r.lastRunAt ? (
                <>
                  {/* Local time: the server (UTC) and the browser can differ. */}
                  Last ran <span suppressHydrationWarning>{new Date(r.lastRunAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                  {r.lastOk === false && <span className="text-destructive-ink"> · with a problem</span>}
                </>
              ) : (
                "Hasn’t run yet"
              )}
            </button>
            {openRuns === r.id && (
              <ul aria-label={`Runs of ${r.name}`} className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md bg-surface-muted p-2 text-xs">
                {runs === null && <li className="text-muted-foreground">Loading…</li>}
                {runs?.length === 0 && <li className="text-muted-foreground">No runs yet.</li>}
                {(runs ?? []).map((run) => (
                  <li key={run.id} className="flex items-start gap-2">
                    {run.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success-ink" aria-label="Ran" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive-ink" aria-label="Problem" />}
                    <span className="shrink-0 text-muted-foreground tabular-nums">{new Date(run.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</span>
                    {run.cardKey && <span className="shrink-0 font-mono">{run.cardKey}</span>}
                    <span>{run.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {draft ? (
        <RuleEditor
          draft={draft}
          setDraft={setDraft}
          data={data}
          onSaved={() => {
            setDraft(null);
            router.refresh();
          }}
        />
      ) : (
        <Button className="self-start" onClick={() => setDraft({ id: null, name: "", enabled: true, boardId: null, trigger: { kind: "status_changed", to: "" }, condition: "", actions: [blankAction("add_comment", data)] })}>
          <Plus className="size-4" aria-hidden="true" />
          New rule
        </Button>
      )}
    </div>
  );
}

function RuleEditor({ draft, setDraft, data, onSaved }: { draft: Draft; setDraft: (d: Draft | null) => void; data: Data; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const setAction = (i: number, a: Action) => set({ actions: draft.actions.map((x, j) => (j === i ? a : x)) });
  const t = draft.trigger;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveAutomationRule(draft.id, { name: draft.name, enabled: draft.enabled, boardId: draft.boardId, trigger: draft.trigger, condition: draft.condition, actions: draft.actions });
    setBusy(false);
    if ("error" in res && res.error) setError(res.error);
    else onSaved();
  }

  async function check() {
    setPreview(null);
    if (!draft.condition.trim()) return setPreview("No condition: every card.");
    const r = await previewAutomationCondition(draft.condition, draft.boardId);
    setPreview("error" in r && r.error ? `Problem: ${r.error}` : `${(r as { count: number }).count} cards match right now.`);
  }

  const people = data.members.map((m) => ({ value: m.email, label: m.name ? `${m.name} (${m.email})` : m.email }));

  return (
    <section aria-labelledby="rule-editor" className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <h3 id="rule-editor" className="font-semibold">
        {draft.id ? "Edit rule" : "New rule"}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-name">Name</Label>
          <Input id="rule-name" value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="Move reviewed cards to Done" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-board">Boards</Label>
          <Select id="rule-board" value={draft.boardId ?? ""} onChange={(e) => set({ boardId: e.target.value || null })}>
            <option value="">Every board</option>
            {data.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">When</legend>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Trigger" value={t.kind} onChange={(e) => set({ trigger: blankTrigger(e.target.value as Trigger["kind"]) })} className="w-auto">
            {TRIGGERS.map((k) => (
              <option key={k} value={k}>
                {TRIGGER_LABEL[k]}
              </option>
            ))}
          </Select>
          {t.kind === "status_changed" && (
            <Select aria-label="To status" value={t.to} onChange={(e) => set({ trigger: { ...t, to: e.target.value } })} className="w-auto">
              <option value="">to any status</option>
              {data.statuses.map((s) => (
                <option key={s.name} value={s.name}>
                  to {s.name}
                </option>
              ))}
            </Select>
          )}
          {t.kind === "field_changed" && (
            <>
              <Select aria-label="Field" value={t.field} onChange={(e) => set({ trigger: { ...t, field: e.target.value as typeof t.field } })} className="w-auto">
                {WATCHED_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {f === "custom" ? "a custom field" : f}
                  </option>
                ))}
              </Select>
              {t.field === "custom" && (
                <Select aria-label="Custom field" value={t.custom} onChange={(e) => set({ trigger: { ...t, custom: e.target.value } })} className="w-auto">
                  <option value="">Pick a field</option>
                  {data.fields.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              )}
            </>
          )}
          {t.kind === "due_soon" && (
            <label className="flex items-center gap-1.5 text-sm">
              in
              <Input aria-label="Days before due" type="number" min={0} max={60} value={t.days} onChange={(e) => set({ trigger: { ...t, days: Math.max(0, Math.min(60, Number(e.target.value) || 0)) } })} className="h-9 w-20" />
              days (checked daily at 7:00 UTC)
            </label>
          )}
          {t.kind === "schedule" && (
            <Select aria-label="How often" value={t.every} onChange={(e) => set({ trigger: { ...t, every: e.target.value as "day" | "week" } })} className="w-auto">
              <option value="day">every day</option>
              <option value="week">every Monday</option>
            </Select>
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">If the card matches {t.kind === "schedule" ? "(required)" : "(optional)"}</legend>
        <div className="flex gap-2">
          <Input aria-label="Condition" value={draft.condition} onChange={(e) => set({ condition: e.target.value })} placeholder='priority >= high AND labels = qa' className="font-mono text-sm" />
          <Button variant="outline" onClick={check}>
            Check
          </Button>
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {preview ?? "The same query language as the Cards page. Empty means every card."}
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Then</legend>
        {draft.actions.map((a, i) => (
          <div key={i} className="flex flex-wrap items-start gap-2 rounded-md bg-surface-muted p-2">
            <Select aria-label={`Action ${i + 1}`} value={a.kind} onChange={(e) => setAction(i, blankAction(e.target.value as ActionKind, data))} className="w-auto">
              {(Object.keys(ACTION_LABEL) as ActionKind[]).map((k) => (
                <option key={k} value={k}>
                  {ACTION_LABEL[k]}
                </option>
              ))}
            </Select>
            <ActionParams a={a} i={i} data={data} people={people} onChange={(next) => setAction(i, next)} />
            <span className="flex-1" />
            <Button variant="ghost" size="icon-xs" aria-label={`Remove action ${i + 1}`} disabled={draft.actions.length === 1} onClick={() => set({ actions: draft.actions.filter((_, j) => j !== i) })}>
              <X className="size-3.5" />
            </Button>
          </div>
        ))}
        {draft.actions.length < 10 && (
          <Button variant="outline" size="sm" className="self-start" onClick={() => set({ actions: [...draft.actions, blankAction("add_label", data)] })}>
            <Plus className="size-3.5" aria-hidden="true" />
            Add an action
          </Button>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="size-4 accent-[var(--accent)]" />
        Turn the rule on
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive-ink">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>
          Save rule
        </Button>
        <Button variant="ghost" onClick={() => setDraft(null)}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function ActionParams({ a, i, data, people, onChange }: { a: Action; i: number; data: Data; people: { value: string; label: string }[]; onChange: (a: Action) => void }) {
  const n = `action ${i + 1}`;
  const pick = (label: string, value: string, options: { value: string; label: string }[], set: (v: string) => void) => (
    <Select aria-label={`${label} (${n})`} value={value} onChange={(e) => set(e.target.value)} className="w-auto">
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
  switch (a.kind) {
    case "set_status":
      return pick("Status", a.status, data.statuses.map((s) => ({ value: s.name, label: s.name })), (v) => onChange({ ...a, status: v }));
    case "assign":
    case "watch":
      return pick("Person", a.person, people, (v) => onChange({ ...a, person: v }));
    case "unassign":
      return pick("Person", a.person, [{ value: "everyone", label: "Everyone" }, ...people], (v) => onChange({ ...a, person: v }));
    case "set_priority":
      return pick("Priority", a.priority, ["highest", "high", "medium", "low", "lowest", "none"].map((p) => ({ value: p, label: p === "none" ? "No priority" : p[0].toUpperCase() + p.slice(1) })), (v) => onChange({ ...a, priority: v as typeof a.priority }));
    case "add_label":
    case "remove_label":
      return pick("Label", a.label, data.labels.map((l) => ({ value: l.name, label: l.name })), (v) => onChange({ ...a, label: v }));
    case "set_field": {
      const f = data.fields.find((x) => x.name === a.field);
      return (
        <>
          {pick("Field", a.field, data.fields.map((x) => ({ value: x.name, label: x.name })), (v) => onChange({ ...a, field: v, value: "" }))}
          {f && (f.type === "select" || f.type === "multiselect") ? (
            pick("Value", a.value, [{ value: "", label: "(clear it)" }, ...f.options.map((o) => ({ value: o, label: o }))], (v) => onChange({ ...a, value: v }))
          ) : (
            <Input aria-label={`Value (${n})`} value={a.value} onChange={(e) => onChange({ ...a, value: e.target.value })} placeholder={f?.type === "date" ? "YYYY-MM-DD" : f?.type === "checkbox" ? "true or false" : f?.type === "person" ? "an email" : "value (empty clears)"} className="h-9 w-48" />
          )}
        </>
      );
    }
    case "set_due":
      return (
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={a.days !== null} onChange={(e) => onChange({ ...a, days: e.target.checked ? 7 : null })} className="size-4 accent-[var(--accent)]" aria-label={`Set a date (${n})`} />
          {a.days === null ? "clear it" : (
            <>
              in <Input aria-label={`Days from today (${n})`} type="number" value={a.days} onChange={(e) => onChange({ ...a, days: Number(e.target.value) || 0 })} className="h-9 w-20" /> days
            </>
          )}
        </label>
      );
    case "add_comment":
      return <Textarea aria-label={`Comment (${n})`} value={a.text} onChange={(e) => onChange({ ...a, text: e.target.value })} rows={2} className="min-w-64 flex-1" placeholder="Posted as the rule" />;
    case "add_subtask":
      return <Input aria-label={`Subtask title (${n})`} value={a.title} onChange={(e) => onChange({ ...a, title: e.target.value })} className="h-9 w-64" />;
    case "notify":
      return (
        <div className="flex min-w-64 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {pick("Who", a.to, [{ value: "assignees", label: "its assignees" }, { value: "watchers", label: "its watchers" }, { value: "person", label: "someone" }], (v) => onChange({ ...a, to: v as typeof a.to, person: v === "person" ? a.person || people[0]?.value || "" : a.person }))}
            {a.to === "person" && pick("Person", a.person, people, (v) => onChange({ ...a, person: v }))}
          </div>
          <Textarea aria-label={`Message (${n})`} value={a.message} onChange={(e) => onChange({ ...a, message: e.target.value })} rows={2} placeholder="What the email says" />
        </div>
      );
  }
}
