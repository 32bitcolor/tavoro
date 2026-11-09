"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";

import { createCustomField, deleteCustomField, moveCustomField, updateCustomField } from "@/app/actions/custom-fields";
import { ConfirmDelete } from "@/components/shared/confirm-delete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FIELD_TYPES, FIELD_TYPE_LABEL, type CustomFieldDef, type FieldOption, type FieldType } from "@/lib/custom-fields";

// Settings → Cards & labels → Custom fields (docs/JIRA-PARITY.md, phase 8).

type Board = { id: string; name: string };
type Draft = { id?: string; name: string; type: FieldType; options: FieldOption[]; all: boolean; boardIds: string[] };

const newId = () => Math.random().toString(36).slice(2, 10);
const blank = (): Draft => ({ name: "", type: "text", options: [], all: true, boardIds: [] });

export function CustomFieldsManager({ initial, boards, uses }: { initial: CustomFieldDef[]; boards: Board[]; uses: Record<string, number> }) {
  const [fields, setFields] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const options = draft.options.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label);
    const payload = { name: draft.name, options, boardIds: draft.all ? null : draft.boardIds };
    const res = draft.id ? await updateCustomField(draft.id, payload) : await createCustomField({ ...payload, type: draft.type });
    setBusy(false);
    if ("error" in res && res.error) {
      setError(res.error);
      return;
    }
    if ("field" in res && res.field) setFields((fs) => [...fs, res.field!]);
    else setFields((fs) => fs.map((f) => (f.id === draft.id ? { ...f, name: draft.name.trim(), options, allBoards: draft.all, boardIds: draft.all ? [] : draft.boardIds } : f)));
    setDraft(null);
  }

  async function move(id: string, dir: -1 | 1) {
    const i = fields.findIndex((f) => f.id === id);
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
    await moveCustomField(id, dir);
  }

  const selectType = draft && (draft.type === "select" || draft.type === "multiselect");

  return (
    <section aria-labelledby="custom-fields" className="flex flex-col gap-3">
      <div>
        <h2 id="custom-fields" className="text-base font-semibold">
          Custom fields
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Extra fields on cards — an audience, a course code, a reviewer. They show in the card panel on the boards you choose, and you can query
          them on the Cards page (<code className="text-xs">&quot;Audience&quot; = Managers</code>).
        </p>
      </div>

      {fields.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {fields.map((f, i) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="font-medium">{f.name}</span>
              <span className="text-xs text-muted-foreground">{FIELD_TYPE_LABEL[f.type]}</span>
              {f.options.length > 0 && <span className="min-w-0 truncate text-xs text-muted-foreground">{f.options.map((o) => o.label).join(", ")}</span>}
              <span className="text-xs text-muted-foreground">
                · {f.allBoards ? "All boards" : `${f.boardIds.length} ${f.boardIds.length === 1 ? "board" : "boards"}`} · {uses[f.id] ?? 0} {uses[f.id] === 1 ? "card" : "cards"}
              </span>
              <span className="flex-1" />
              <Button variant="ghost" size="icon-xs" aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => move(f.id, -1)}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={`Move ${f.name} down`} disabled={i === fields.length - 1} onClick={() => move(f.id, 1)}>
                <ArrowDown className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={`Edit ${f.name}`} onClick={() => setDraft({ id: f.id, name: f.name, type: f.type, options: f.options, all: f.allBoards, boardIds: f.boardIds })}>
                <Pencil className="size-3.5" />
              </Button>
              <ConfirmDelete
                title={`Delete the field “${f.name}”?`}
                description={`Its values on ${uses[f.id] ?? 0} ${uses[f.id] === 1 ? "card" : "cards"} are deleted too. This can’t be undone.`}
                confirmLabel="Delete field"
                onConfirm={async () => {
                  await deleteCustomField(f.id);
                  setFields((fs) => fs.filter((x) => x.id !== f.id));
                }}
                trigger={
                  <Button variant="ghost" size="icon-xs" aria-label={`Delete ${f.name}`} className="text-muted-foreground hover:text-destructive-ink">
                    <Trash2 className="size-3.5" />
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cf-name">Name</Label>
              <Input id="cf-name" value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cf-type">Type</Label>
              <Select id="cf-type" value={draft.type} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, type: e.target.value as FieldType, options: draft.options.length ? draft.options : [] })}>
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FIELD_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
              {draft.id && <p className="text-xs text-muted-foreground">A field&rsquo;s type can&rsquo;t change once it has values.</p>}
            </div>
          </div>
          {selectType && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-medium">Options</legend>
              {draft.options.map((o, i) => (
                <div key={o.id} className="flex items-center gap-2">
                  <Input
                    aria-label={`Option ${i + 1}`}
                    value={o.label}
                    maxLength={80}
                    onChange={(e) => setDraft({ ...draft, options: draft.options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })}
                    className="h-8"
                  />
                  <Button variant="ghost" size="icon-xs" aria-label={`Remove option ${o.label || i + 1}`} onClick={() => setDraft({ ...draft, options: draft.options.filter((x) => x.id !== o.id) })}>
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="self-start" onClick={() => setDraft({ ...draft, options: [...draft.options, { id: newId(), label: "" }] })}>
                <Plus className="size-3.5" aria-hidden="true" />
                Add option
              </Button>
            </fieldset>
          )}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">Show on</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="cf-scope" checked={draft.all} onChange={() => setDraft({ ...draft, all: true })} className="accent-[var(--accent)]" />
              Every board
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="cf-scope" checked={!draft.all} onChange={() => setDraft({ ...draft, all: false })} className="accent-[var(--accent)]" />
              Only these boards
            </label>
            {!draft.all && (
              <div className="ml-6 grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
                {boards.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.boardIds.includes(b.id)}
                      onChange={(e) => setDraft({ ...draft, boardIds: e.target.checked ? [...draft.boardIds, b.id] : draft.boardIds.filter((x) => x !== b.id) })}
                      className="size-4 accent-[var(--accent)]"
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive-ink">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>
              {draft.id ? "Save field" : "Add field"}
            </Button>
            <Button variant="ghost" onClick={() => (setDraft(null), setError(null))}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="self-start" onClick={() => setDraft(blank())}>
          <Plus className="size-4" aria-hidden="true" />
          Add a field
        </Button>
      )}
    </section>
  );
}
