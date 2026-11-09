"use client";

import { useEffect, useState } from "react";

import { getCardFields, setCardFieldValue } from "@/app/actions/custom-fields";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { CustomFieldDef, FieldValue } from "@/lib/custom-fields";
import { cn } from "@/lib/utils";

// The card panel's custom fields (docs/JIRA-PARITY.md, phase 8): the fields admins
// added for this card's board, each edited in place. Nothing shows if there are none.

type F = CustomFieldDef & { value: FieldValue };

export function CardFieldsSection({ cardId, members }: { cardId: string; members: { id: string; name: string | null; email: string }[] }) {
  const [fields, setFields] = useState<F[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    getCardFields(cardId).then((r) => live && setFields(r.fields));
    return () => {
      live = false;
    };
  }, [cardId]);

  if (!fields || fields.length === 0) return null;

  async function save(f: F, value: FieldValue) {
    const prev = f.value;
    setFields((fs) => fs!.map((x) => (x.id === f.id ? { ...x, value } : x)));
    setErrors((e) => ({ ...e, [f.id]: "" }));
    const r = await setCardFieldValue(cardId, f.id, value);
    if ("error" in r && r.error) {
      setFields((fs) => fs!.map((x) => (x.id === f.id ? { ...x, value: prev } : x)));
      setErrors((e) => ({ ...e, [f.id]: r.error! }));
    } else if ("value" in r) setFields((fs) => fs!.map((x) => (x.id === f.id ? { ...x, value: r.value ?? null } : x)));
  }

  return (
    <section aria-labelledby={`fields-${cardId}`}>
      <h3 id={`fields-${cardId}`} className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Fields
      </h3>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.id} className={cn(f.type === "multiselect" || f.type === "text" ? "sm:col-span-2" : "")}>
            <label htmlFor={`cf-${f.id}`} className="mb-1 block text-xs font-medium text-muted-foreground">
              {f.name}
            </label>
            <Editor f={f} members={members} onSave={(v) => save(f, v)} />
            {errors[f.id] && (
              <p role="alert" className="mt-1 text-xs text-destructive-ink">
                {errors[f.id]}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Editor({ f, members, onSave }: { f: F; members: { id: string; name: string | null; email: string }[]; onSave: (v: FieldValue) => void }) {
  const id = `cf-${f.id}`;
  const [draft, setDraft] = useState(f.value == null ? "" : String(f.value));
  // Keep the draft in step when the saved value changes (a revert, or another card).
  const [seen, setSeen] = useState(f.value);
  if (seen !== f.value) {
    setSeen(f.value);
    setDraft(f.value == null ? "" : String(f.value));
  }
  const commit = () => {
    const v = draft.trim();
    if ((f.value == null ? "" : String(f.value)) === v) return;
    onSave(v === "" ? null : f.type === "number" ? v : v);
  };
  switch (f.type) {
    case "text":
    case "number":
      return (
        <Input
          id={id}
          value={draft}
          inputMode={f.type === "number" ? "decimal" : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          className={cn("h-8", f.type === "number" && "w-32")}
          placeholder="—"
        />
      );
    case "date":
      return <Input id={id} type="date" value={f.value ? String(f.value) : ""} onChange={(e) => onSave(e.target.value || null)} className="h-8 w-auto" />;
    case "checkbox":
      return (
        <input id={id} type="checkbox" checked={f.value === true} onChange={(e) => onSave(e.target.checked)} className="size-4 accent-[var(--accent)]" />
      );
    case "select":
      return (
        <Select id={id} value={f.value ? String(f.value) : ""} onChange={(e) => onSave(e.target.value || null)} className="h-8 py-1 text-sm">
          <option value="">—</option>
          {f.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case "person":
      return (
        <Select id={id} value={f.value ? String(f.value) : ""} onChange={(e) => onSave(e.target.value || null)} className="h-8 py-1 text-sm">
          <option value="">—</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? m.email}
            </option>
          ))}
        </Select>
      );
    case "multiselect": {
      const on = new Set(Array.isArray(f.value) ? f.value : []);
      return (
        <div id={id} role="group" aria-label={f.name} className="flex flex-wrap gap-1.5">
          {f.options.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={on.has(o.id)}
              onClick={() => {
                const next = new Set(on);
                if (next.has(o.id)) next.delete(o.id);
                else next.add(o.id);
                onSave(f.options.map((x) => x.id).filter((x) => next.has(x)));
              }}
              className={cn(
                "h-7 rounded-full border px-2.5 text-xs font-medium",
                on.has(o.id) ? "border-accent bg-accent/15 text-foreground" : "border-border text-muted-foreground hover:bg-hover",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      );
    }
  }
}
