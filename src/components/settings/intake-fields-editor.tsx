"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, ListPlus, Plus, Trash2 } from "lucide-react";

import { setIntakeFields } from "@/app/actions/intake";
import { INTAKE_FIELD_TYPES, INTAKE_FIELD_TYPE_LABEL, MAX_INTAKE_FIELDS, newFieldId, type IntakeField, type IntakeFieldType } from "@/lib/intake-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Draft = { id: string; label: string; help: string; type: IntakeFieldType; required: boolean; options: string };
const toDraft = (f: IntakeField): Draft => ({ id: f.id, label: f.label, help: f.help ?? "", type: f.type, required: f.required, options: f.options.join("\n") });
const toField = (d: Draft) => ({
  id: d.id,
  label: d.label.trim(),
  help: d.help.trim(),
  type: d.type,
  required: d.required,
  options: d.type === "choice" ? d.options.split("\n").map((o) => o.trim()).filter(Boolean) : [],
});

/** Settings → Intake: the workspace's own questions on the request form. */
export function IntakeFieldsEditor({ initial, formUrl }: { initial: IntakeField[]; formUrl: string }) {
  const [saved, setSaved] = useState(() => initial.map(toDraft));
  const [fields, setFields] = useState(() => initial.map(toDraft));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(fields) !== JSON.stringify(saved);

  const patch = (i: number, p: Partial<Draft>) => setFields((fs) => fs.map((f, k) => (k === i ? { ...f, ...p } : f)));
  const move = (i: number, d: -1 | 1) =>
    setFields((fs) => {
      const j = i + d;
      if (j < 0 || j >= fs.length) return fs;
      const next = fs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function save() {
    setMessage(null);
    start(async () => {
      const res = await setIntakeFields(fields.map(toField));
      if ("error" in res) return setMessage({ tone: "error", text: res.error ?? "Couldn't save." });
      setSaved(fields);
      setMessage({ tone: "ok", text: "Saved. The form shows these questions now." });
    });
  }

  return (
    <section className="rounded-xl border border-border p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
          <ListPlus className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">Your questions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The form always asks for a name, email, what they need and the details, plus an optional audience and date. Add up to{" "}
            {MAX_INTAKE_FIELDS} questions of your own, such as the business goal, how many people it&rsquo;s for, or whether it&rsquo;s
            required for compliance. Answers appear on the request and in the project it becomes.{" "}
            <a href={formUrl} target="_blank" rel="noopener noreferrer" className="text-link">
              Open the form
            </a>
          </p>

          <ol className="mt-4 flex flex-col gap-3">
            {fields.map((f, i) => (
              <li key={f.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1 basis-60">
                    <label htmlFor={`if-label-${f.id}`} className="sr-only">
                      Question {i + 1}
                    </label>
                    <Input id={`if-label-${f.id}`} value={f.label} onChange={(e) => patch(i, { label: e.target.value })} maxLength={120} placeholder="Question" />
                  </div>
                  <Select aria-label={`Answer type for question ${i + 1}`} value={f.type} onChange={(e) => patch(i, { type: e.target.value as IntakeFieldType })} className="w-auto">
                    {INTAKE_FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {INTAKE_FIELD_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                  <div className="flex items-center">
                    <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ChevronUp className="size-4" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Move question ${i + 1} down`} disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                      <ChevronDown className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8 text-destructive-ink"
                      aria-label={`Remove question ${i + 1}`}
                      onClick={() => setFields((fs) => fs.filter((_, k) => k !== i))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Input value={f.help} onChange={(e) => patch(i, { help: e.target.value })} maxLength={200} placeholder="Hint (optional)" aria-label={`Hint for question ${i + 1}`} className="h-8 min-w-0 flex-1 basis-60 text-sm" />
                  <label className="inline-flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={f.required} onChange={(e) => patch(i, { required: e.target.checked })} className="accent-[var(--accent)]" />
                    Required
                  </label>
                </div>
                {f.type === "choice" && (
                  <div className="mt-2">
                    <label htmlFor={`if-opts-${f.id}`} className="text-xs text-muted-foreground">
                      Choices, one per line
                    </label>
                    <Textarea id={`if-opts-${f.id}`} rows={3} value={f.options} onChange={(e) => patch(i, { options: e.target.value })} className="mt-1 text-sm" />
                  </div>
                )}
              </li>
            ))}
          </ol>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={fields.length >= MAX_INTAKE_FIELDS}
              onClick={() => setFields((fs) => [...fs, { id: newFieldId(), label: "", help: "", type: "text", required: false, options: "" }])}
            >
              <Plus className="size-4" aria-hidden="true" /> Add a question
            </Button>
            <Button type="button" size="sm" disabled={!dirty || pending} onClick={save}>
              {pending ? "Saving…" : "Save questions"}
            </Button>
            {dirty && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setFields(saved)}>
                Discard
              </Button>
            )}
            {message && (
              <p role="status" className={message.tone === "error" ? "text-sm text-destructive-ink" : "text-sm text-muted-foreground"}>
                {message.text}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
