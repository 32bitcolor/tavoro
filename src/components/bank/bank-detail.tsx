"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, CopyPlus, Trash2 } from "lucide-react";

import { copyBankItemToProject, deleteBankItem, setBankItemArchived, setBankItemLabels, updateBankItem, type BankFields } from "@/app/actions/bank";
import { BANK_KINDS, BANK_KIND_LABEL, BANK_PROMPT_MAX, type BankKind } from "@/lib/bank";
import { ASSESSMENT_ITEM_TYPES, ASSESSMENT_ITEM_TYPE_LABEL, BLOOM_LEVELS, BLOOM_LABEL, type AssessmentItemType, type BloomLevel } from "@/lib/methodology";
import { useSetPageTitle } from "@/components/app-shell/breadcrumbs";
import { ConfirmDelete } from "@/components/shared/confirm-delete";
import { StatusBadge } from "@/components/shared/status-badge";
import { SectionHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PickDialog, type PickOption } from "@/components/assets/pick-dialog";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  kind: string;
  prompt: string;
  itemType: string;
  bloomLevel: string | null;
  notes: string | null;
  archived: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  labelIds: string[];
};
type Usage = { copies: { id: string; prompt: string; project: { id: string; name: string } }[]; hidden: number };
type Form = { prompt: string; kind: string; itemType: string; bloomLevel: string; notes: string };
const formOf = (i: Item): Form => ({ prompt: i.prompt, kind: i.kind, itemType: i.itemType, bloomLevel: i.bloomLevel ?? "", notes: i.notes ?? "" });

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function BankDetail({
  item,
  usage,
  projects,
  labels,
  canDelete,
}: {
  item: Item;
  usage: Usage;
  projects: PickOption[];
  labels: { id: string; name: string; color: string }[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => formOf(item));
  const [labelIds, setLabelIds] = useState(() => new Set(item.labelIds));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: React.ReactNode } | null>(null);
  const [picking, setPicking] = useState(false);
  const [pending, start] = useTransition();
  const [seen, setSeen] = useState(item.updatedAt);
  if (seen !== item.updatedAt) {
    setSeen(item.updatedAt);
    setForm(formOf(item));
  }
  const short = item.prompt.length > 60 ? `${item.prompt.slice(0, 57)}…` : item.prompt;
  useSetPageTitle(short, [{ label: "Question bank", href: "/bank" }]);

  const saved = formOf(item);
  const dirty = (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== saved[k]);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function run(fn: () => Promise<unknown>, ok?: React.ReactNode) {
    setMessage(null);
    start(async () => {
      const res = (await fn()) as { error?: string } | undefined;
      if (res && "error" in res && res.error) setMessage({ tone: "error", text: res.error });
      else {
        if (ok) setMessage({ tone: "ok", text: ok });
        router.refresh();
      }
    });
  }

  function save() {
    const patch: Partial<BankFields> = {
      prompt: form.prompt.trim(),
      kind: form.kind as BankKind,
      itemType: form.itemType as AssessmentItemType,
      bloomLevel: (form.bloomLevel || null) as BloomLevel | null,
      notes: form.notes.trim() || null,
    };
    run(() => updateBankItem(item.id, patch), "Saved. Copies already in projects are unchanged.");
  }

  function toggleLabel(id: string) {
    const next = new Set(labelIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setLabelIds(next);
    run(() => setBankItemLabels(item.id, [...next]));
  }

  function copyTo(projectId: string) {
    setPicking(false);
    const name = projects.find((p) => p.id === projectId)?.label ?? "the project";
    setMessage(null);
    start(async () => {
      const res = await copyBankItemToProject(item.id, projectId);
      if ("error" in res) return setMessage({ tone: "error", text: res.error });
      setMessage({
        tone: "ok",
        text: (
          <>
            Copied into{" "}
            <Link href={`/projects/${projectId}`} className="text-link">
              {name}
            </Link>
            .
          </>
        ),
      });
      router.refresh();
    });
  }

  const byProject = new Map<string, { name: string; n: number }>();
  for (const c of usage.copies) {
    const e = byProject.get(c.project.id) ?? { name: c.project.name, n: 0 };
    e.n++;
    byProject.set(c.project.id, e);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{BANK_KIND_LABEL[item.kind as BankKind] ?? "Bank item"}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          {item.archived && <StatusBadge tone="neutral">Archived</StatusBadge>}
          <span>
            Added {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            {item.createdBy ? ` by ${item.createdBy}` : ""}
          </span>
        </div>
      </div>

      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <section className="flex flex-col gap-4">
          <Field label={form.kind === "scenario" ? "Scenario" : "Question"} htmlFor="b-prompt">
            <Textarea id="b-prompt" rows={4} value={form.prompt} onChange={set("prompt")} maxLength={BANK_PROMPT_MAX} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3 [&>*]:min-w-0">
            <Field label="Kind" htmlFor="b-kind">
              <Select id="b-kind" value={form.kind} onChange={set("kind")}>
                {BANK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {BANK_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Item type" htmlFor="b-type" hint="What it becomes in a project.">
              <Select id="b-type" value={form.itemType} onChange={set("itemType")}>
                {ASSESSMENT_ITEM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ASSESSMENT_ITEM_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Level" htmlFor="b-bloom" hint="The Bloom level it assesses.">
              <Select id="b-bloom" value={form.bloomLevel} onChange={set("bloomLevel")}>
                <option value="">Not set</option>
                {BLOOM_LEVELS.map((b) => (
                  <option key={b} value={b}>
                    {BLOOM_LABEL[b]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Notes" htmlFor="b-notes" hint="The answer and why, distractors, the policy it comes from: anything the next designer needs. Notes stay in the bank.">
            <Textarea id="b-notes" rows={5} value={form.notes} onChange={set("notes")} maxLength={5000} />
          </Field>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!dirty || pending}>
            Save changes
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => setForm(saved)}>
              Discard
            </Button>
          )}
          {message && (
            <p role="status" className={cn("text-sm", message.tone === "error" ? "text-destructive-ink" : "text-muted-foreground")}>
              {message.text}
            </p>
          )}
        </div>
      </form>

      {labels.length > 0 && (
        <section>
          <SectionHeader>Labels</SectionHeader>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Labels">
            {labels.map((l) => {
              const on = labelIds.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleLabel(l.id)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    on ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:border-border-strong",
                  )}
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: l.color }} aria-hidden="true" />
                  {l.name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <SectionHeader
          action={
            !item.archived && (
              <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
                <CopyPlus className="size-4" aria-hidden="true" /> Copy into a project
              </Button>
            )
          }
        >
          Used in
        </SectionHeader>
        {byProject.size === 0 && usage.hidden === 0 ? (
          <p className="text-sm text-muted-foreground">Not copied into any project yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {[...byProject.entries()].map(([id, p]) => (
              <li key={id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Link href={`/projects/${id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {p.name}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">{p.n === 1 ? "1 copy" : `${p.n} copies`}</span>
              </li>
            ))}
            {usage.hidden > 0 && (
              <li className="px-4 py-2.5 text-sm text-muted-foreground">
                {usage.hidden === 1 ? "1 copy" : `${usage.hidden} copies`} in projects you don&rsquo;t have access to
              </li>
            )}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Copies are independent: editing this entry never changes them, and editing a copy never changes the bank.
        </p>
        <PickDialog open={picking} onOpenChange={setPicking} title="Copy into a project" options={projects} empty="No projects you can open." onPick={copyTo} />
      </section>

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => setBankItemArchived(item.id, !item.archived), item.archived ? "Restored." : "Archived.")}
        >
          {item.archived ? <ArchiveRestore className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}
          {item.archived ? "Restore" : "Archive"}
        </Button>
        {canDelete && (
          <ConfirmDelete
            title="Delete this bank item?"
            description="It leaves the bank for good. Copies already in projects stay, but they'll no longer say where they came from. To stop it being reused, archive it instead."
            onConfirm={async () => {
              const res = await deleteBankItem(item.id);
              if ("error" in res) return res;
              router.push("/bank");
            }}
            trigger={
              <Button variant="ghost" size="sm" className="text-destructive-ink">
                <Trash2 className="size-4" aria-hidden="true" /> Delete
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
