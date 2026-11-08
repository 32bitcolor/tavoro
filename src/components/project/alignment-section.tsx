"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ChevronUp, ChevronDown, X, Target, Plus, BookCheck, BookmarkPlus } from "lucide-react";

import {
  createObjective,
  setObjectiveText,
  setObjectiveBloom,
  moveObjective,
  deleteObjective,
  createAssessmentItem,
  setAssessmentItemPrompt,
  setAssessmentItemType,
  deleteAssessmentItem,
  toggleItemObjective,
} from "@/app/actions/objectives";
import { copyBankItemToProject, saveAssessmentItemToBank } from "@/app/actions/bank";
import { PickDialog, type PickOption } from "@/components/assets/pick-dialog";
import {
  BLOOM_LEVELS,
  BLOOM_LABEL,
  BLOOM_VERBS,
  ASSESSMENT_ITEM_TYPES,
  ASSESSMENT_ITEM_TYPE_LABEL,
  type BloomLevel,
  type AssessmentItemType,
} from "@/lib/methodology";
import { SectionHeader } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDelete } from "@/components/shared/confirm-delete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

export type ObjectiveInit = {
  id: string;
  text: string;
  bloomLevel: string;
  position: string;
  screenCount: number;
};
export type AssessmentInit = {
  id: string;
  prompt: string;
  itemType: string;
  position: string;
  sourceBankItemId: string | null;
  objectiveIds: string[];
};
type Coverage = { totalScreens: number; orphanScreens: number };

function move<T>(arr: T[], from: number, to: number) {
  const next = arr.slice();
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

export function AlignmentSection({
  projectId,
  initialObjectives,
  initialAssessments,
  bankOptions,
  coverage,
}: {
  projectId: string;
  initialObjectives: ObjectiveInit[];
  initialAssessments: AssessmentInit[];
  bankOptions: PickOption[];
  coverage: Coverage;
}) {
  const [objectives, setObjectives] = useState<ObjectiveInit[]>(initialObjectives);
  const [items, setItems] = useState<AssessmentInit[]>(initialAssessments);
  const [, startTransition] = useTransition();
  const [pickingBank, setPickingBank] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);

  // "Assessed" counts derive from the items state so they update live as you link.
  const assessedCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) for (const oid of it.objectiveIds) m.set(oid, (m.get(oid) ?? 0) + 1);
    return m;
  }, [items]);

  const untaught = objectives.filter((o) => o.screenCount === 0).length;
  const unassessed = objectives.filter((o) => (assessedCount.get(o.id) ?? 0) === 0).length;

  // ── objective ops ──
  function patchObj(id: string, p: Partial<ObjectiveInit>) {
    setObjectives((prev) => prev.map((o) => (o.id === id ? { ...o, ...p } : o)));
  }
  async function addObjective(text: string, bloom: string) {
    const res = await createObjective(projectId, text, bloom);
    if ("objective" in res && res.objective) {
      setObjectives((prev) => [...prev, { ...res.objective, screenCount: 0 }]);
    }
  }
  function reorderObj(index: number, dir: -1 | 1) {
    const to = index + dir;
    if (to < 0 || to >= objectives.length) return;
    setObjectives((prev) => move(prev, index, to));
    startTransition(() => void moveObjective(objectives[index].id, to));
  }
  function removeObjective(id: string) {
    setObjectives((prev) => prev.filter((o) => o.id !== id));
    setItems((prev) => prev.map((it) => ({ ...it, objectiveIds: it.objectiveIds.filter((x) => x !== id) })));
    startTransition(() => void deleteObjective(id));
  }

  // ── assessment ops ──
  function patchItem(id: string, p: Partial<AssessmentInit>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }
  async function addItem(prompt: string, type: string) {
    const res = await createAssessmentItem(projectId, prompt, type);
    if ("item" in res && res.item) {
      setItems((prev) => [...prev, { ...res.item, sourceBankItemId: null, objectiveIds: [] }]);
    }
  }
  async function addFromBank(bankItemId: string) {
    setPickingBank(false);
    setBankError(null);
    const res = await copyBankItemToProject(bankItemId, projectId);
    if ("error" in res) return setBankError(res.error ?? "Couldn't copy it.");
    setItems((prev) => [...prev, { ...res.item, objectiveIds: [] }]);
  }
  async function saveToBank(id: string) {
    setBankError(null);
    const res = await saveAssessmentItemToBank(id);
    if ("error" in res) return setBankError(res.error ?? "Couldn't save it.");
    patchItem(id, { sourceBankItemId: res.id });
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    startTransition(() => void deleteAssessmentItem(id));
  }
  function toggleLink(item: AssessmentInit, objectiveId: string) {
    const on = !item.objectiveIds.includes(objectiveId);
    patchItem(item.id, {
      objectiveIds: on
        ? [...item.objectiveIds, objectiveId]
        : item.objectiveIds.filter((x) => x !== objectiveId),
    });
    startTransition(() => void toggleItemObjective(item.id, objectiveId, on));
  }

  const shortLabel = (o: ObjectiveInit, i: number) => `O${i + 1}`;

  return (
    <section className="mt-8">
      <SectionHeader
        action={
          <Link
            href="/help/objectives-alignment"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            How this works →
          </Link>
        }
      >
        Learning objectives &amp; alignment
      </SectionHeader>

      {objectives.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <StatusBadge tone="neutral">{objectives.length} objectives</StatusBadge>
          <StatusBadge tone={untaught ? "warning" : "success"}>
            {untaught ? `${untaught} not yet taught` : "all taught"}
          </StatusBadge>
          <StatusBadge tone={unassessed ? "warning" : "success"}>
            {unassessed ? `${unassessed} not yet assessed` : "all assessed"}
          </StatusBadge>
          {coverage.orphanScreens > 0 && (
            <StatusBadge tone="warning">
              {coverage.orphanScreens} of {coverage.totalScreens} screens teach no objective
            </StatusBadge>
          )}
        </div>
      )}

      {/* Objectives + coverage */}
      <div className="flex flex-col gap-2">
        {objectives.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No objectives yet. Start with what a learner should be able to <em>do</em> after this.
          </p>
        )}
        {objectives.map((o, i) => {
          const taught = o.screenCount;
          const assessed = assessedCount.get(o.id) ?? 0;
          return (
            <div key={o.id} className="rounded-xl border border-border p-3">
              <div className="flex items-start gap-2">
                <span className="mt-1 shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                  {shortLabel(o, i)}
                </span>
                <div className="flex shrink-0 flex-col">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => reorderObj(i, -1)}
                    disabled={i === 0}
                    className="text-muted-foreground"
                    title="Move up"
                  >
                    <ChevronUp className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => reorderObj(i, 1)}
                    disabled={i === objectives.length - 1}
                    className="text-muted-foreground"
                    title="Move down"
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                </div>
                <Textarea aria-label="Objective"
                  value={o.text}
                  onChange={(e) => patchObj(o.id, { text: e.target.value })}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== initialObjectives.find((x) => x.id === o.id)?.text) {
                      startTransition(() => void setObjectiveText(o.id, v));
                    }
                  }}
                  rows={2}
                  className="min-h-0 flex-1 resize-none"
                />
                <ConfirmDelete
                  title="Delete this objective?"
                  description="Its screen and assessment links go too."
                  confirmLabel="Delete objective"
                  onConfirm={() => removeObjective(o.id)}
                  trigger={
                    <Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive-ink" title="Delete objective">
                      <X className="size-4" />
                    </Button>
                  }
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
                <Select aria-label="Bloom's level"
                  value={o.bloomLevel}
                  onChange={(e) => {
                    patchObj(o.id, { bloomLevel: e.target.value });
                    startTransition(() => void setObjectiveBloom(o.id, e.target.value));
                  }}
                  className="h-8 w-auto py-1 text-xs"
                  title="Bloom's cognitive level"
                >
                  {BLOOM_LEVELS.map((b) => (
                    <option key={b} value={b}>{BLOOM_LABEL[b as BloomLevel]}</option>
                  ))}
                </Select>
                <StatusBadge tone={taught ? "success" : "warning"}>
                  {taught ? `Taught · ${taught} screen${taught === 1 ? "" : "s"}` : "Not yet taught"}
                </StatusBadge>
                <StatusBadge tone={assessed ? "success" : "warning"}>
                  {assessed ? `Assessed · ${assessed} item${assessed === 1 ? "" : "s"}` : "Not yet assessed"}
                </StatusBadge>
              </div>
            </div>
          );
        })}
      </div>
      <ObjectiveComposer onAdd={addObjective} />

      {/* Assessment items */}
      <div className="mt-6">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Assessment items
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Questions and checks that measure the objectives — the assessment half of the alignment
          spine (not a full exam engine).
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">No assessment items yet.</p>
          )}
          {items.map((it) => (
            <div key={it.id} className="rounded-xl border border-border p-3">
              <div className="flex items-start gap-2">
                <Textarea aria-label="Assessment item"
                  value={it.prompt}
                  onChange={(e) => patchItem(it.id, { prompt: e.target.value })}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== initialAssessments.find((x) => x.id === it.id)?.prompt) {
                      startTransition(() => void setAssessmentItemPrompt(it.id, v));
                    }
                  }}
                  rows={2}
                  className="min-h-0 flex-1 resize-none"
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeItem(it.id)}
                  className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive-ink"
                  title="Delete item"
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select aria-label="Item type"
                  value={it.itemType}
                  onChange={(e) => {
                    patchItem(it.id, { itemType: e.target.value });
                    startTransition(() => void setAssessmentItemType(it.id, e.target.value));
                  }}
                  className="h-8 w-auto py-1 text-xs"
                >
                  {ASSESSMENT_ITEM_TYPES.map((t) => (
                    <option key={t} value={t}>{ASSESSMENT_ITEM_TYPE_LABEL[t as AssessmentItemType]}</option>
                  ))}
                </Select>
                {it.sourceBankItemId ? (
                  <Link
                    href={`/bank/${it.sourceBankItemId}`}
                    className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                    title="Copied from the question bank. Editing it here doesn't change the bank."
                  >
                    <BookCheck className="size-3" aria-hidden="true" /> From bank
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => void saveToBank(it.id)}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-hover hover:text-foreground"
                    title="Add this to the question bank so other projects can reuse it"
                  >
                    <BookmarkPlus className="size-3" aria-hidden="true" /> Save to bank
                  </button>
                )}
                {objectives.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Add objectives to link this to.</span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Target className="size-3" /> Assesses:
                    </span>
                    {objectives.map((o, i) => {
                      const on = it.objectiveIds.includes(o.id);
                      return (
                        <button
                          key={o.id}
                          onClick={() => toggleLink(it, o.id)}
                          title={o.text}
                          className={
                            "rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors " +
                            (on
                              ? "bg-accent text-accent-foreground"
                              : "bg-muted text-muted-foreground hover:bg-hover")
                          }
                        >
                          {shortLabel(o, i)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <ItemComposer onAdd={addItem} />
          <button
            type="button"
            onClick={() => setPickingBank(true)}
            className="mt-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-hover"
          >
            <BookCheck className="mr-1 inline size-3.5" aria-hidden="true" /> Add from the question bank
          </button>
        </div>
        {bankError && <p className="mt-1 text-sm text-destructive-ink">{bankError}</p>}
        <PickDialog
          open={pickingBank}
          onOpenChange={setPickingBank}
          title="Add from the question bank"
          options={bankOptions}
          empty="The question bank is empty. Save an item to it, or add some under Question bank."
          onPick={(id) => void addFromBank(id)}
        />
      </div>
    </section>
  );
}

function ObjectiveComposer({ onAdd }: { onAdd: (text: string, bloom: string) => void }) {
  const [text, setText] = useState("");
  const [bloom, setBloom] = useState<string>("apply");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-hover"
      >
        <Plus className="mr-1 inline size-3.5" /> Add an objective
      </button>
    );
  }
  function submit() {
    if (text.trim()) onAdd(text.trim(), bloom);
    setText("");
    setOpen(false);
  }
  return (
    <div className="mt-2 rounded-xl border border-border-strong p-3">
      <Textarea aria-label="New objective"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === "Escape") { setText(""); setOpen(false); }
        }}
        rows={2}
        placeholder="After this, the learner will be able to…"
        className="w-full resize-none border-none px-1 shadow-none focus-visible:ring-0"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select aria-label="Bloom's level" value={bloom} onChange={(e) => setBloom(e.target.value)} className="w-auto">
          {BLOOM_LEVELS.map((b) => (
            <option key={b} value={b}>{BLOOM_LABEL[b as BloomLevel]}</option>
          ))}
        </Select>
        <span className="text-xs text-muted-foreground">
          Try: {BLOOM_VERBS[bloom as BloomLevel].slice(0, 4).join(", ")}…
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={submit}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => { setText(""); setOpen(false); }}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function ItemComposer({ onAdd }: { onAdd: (prompt: string, type: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState<string>("multiple_choice");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-hover"
      >
        <Plus className="mr-1 inline size-3.5" /> Add an assessment item
      </button>
    );
  }
  function submit() {
    if (prompt.trim()) onAdd(prompt.trim(), type);
    setPrompt("");
    setOpen(false);
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Input
        autoFocus
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") { setPrompt(""); setOpen(false); } }}
        placeholder="Question or check…"
        className="flex-1"
      />
      <Select aria-label="Item type" value={type} onChange={(e) => setType(e.target.value)} className="w-auto">
        {ASSESSMENT_ITEM_TYPES.map((t) => (
          <option key={t} value={t}>{ASSESSMENT_ITEM_TYPE_LABEL[t as AssessmentItemType]}</option>
        ))}
      </Select>
      <Button size="sm" onClick={submit}>Add</Button>
      <Button size="sm" variant="ghost" onClick={() => { setPrompt(""); setOpen(false); }}>Cancel</Button>
    </div>
  );
}
