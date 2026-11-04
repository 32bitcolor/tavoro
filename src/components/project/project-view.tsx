"use client";

import { useState, useTransition } from "react";
import {
  renameProject,
  setProjectStatus,
  updateProjectDescription,
  deleteProject,
  createPhase,
  renamePhase,
  setPhaseStatus,
  setPhaseDates,
  movePhase,
  deletePhase,
} from "@/app/actions/projects";
import { setProjectSprintsEnabled } from "@/app/actions/sprints";
import {
  PHASE_STATUS_LABEL,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  type PhaseStatus,
  type ProjectStatus,
} from "@/lib/methodology";
import type { RoundSummary } from "@/components/project/review-rounds";
import { ProjectContextStrip, type ProjectContext } from "@/components/board/project-context-strip";
import { useSetPageTitle } from "@/components/app-shell/breadcrumbs";
import Link from "next/link";
import { ChevronUp, ChevronDown, Inbox, X } from "lucide-react";
import { ticketLabel } from "@/lib/intake";
import { AddRowButton, ListPanel, PageContainer, PageHeader, ROW_ACTIONS, SectionHeader } from "@/components/shared/page";
import { StatusDot, type StatusCategory } from "@/components/shared/work-item";
import { cn } from "@/lib/utils";
import { InlineTitle } from "@/components/shared/inline-title";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDelete } from "@/components/shared/confirm-delete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlignmentSection,
  type ObjectiveInit,
  type AssessmentInit,
} from "@/components/project/alignment-section";
import { BoardsSection } from "@/components/project/boards-section";
import { DeliverablesSection } from "@/components/project/deliverables-section";
import { MilestonesSection } from "@/components/project/milestones-section";
import { TimeTracking } from "@/components/project/time-tracking";
import { SaveAsTemplate } from "@/components/templates/save-as-template";

type Phase = {
  id: string;
  name: string;
  status: string;
  position: string;
  startDate: string | null;
  endDate: string | null;
};
type ProjectMeta = {
  id: string;
  name: string;
  description: string | null;
  methodology: string;
  status: string;
  sprintsEnabled: boolean;
  /** The intake request this project was approved from, if any. */
  fromRequest: { id: string; number: number } | null;
};

const NEXT_STATUS: Record<string, PhaseStatus> = {
  not_started: "in_progress",
  in_progress: "done",
  done: "not_started",
};

const PHASE_CATEGORY: Record<string, StatusCategory> = {
  not_started: "todo",
  in_progress: "active",
  done: "done",
};

/** A date that reads as plain text until you hover or focus it. */
function PhaseDate({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string) => void }) {
  return (
    <Input
      type="date"
      aria-label={label}
      value={value ? value.slice(0, 10) : ""}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-7 w-auto border-transparent bg-transparent px-1.5 py-0.5 text-xs shadow-none hover:border-border focus-visible:border-ring",
        !value && "text-muted-foreground",
      )}
    />
  );
}

function move<T>(arr: T[], from: number, to: number) {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

type Member = { id: string; name: string | null; email: string };
type DeliverableInit = {
  id: string;
  name: string;
  type: string;
  status: string;
  phaseId: string | null;
  card: { id: string; title: string; boardId: string; boardName: string } | null;
  storyboard: { id: string; title: string } | null;
  contentItemId: string | null;
  rounds: RoundSummary[];
};
type MilestoneInit = { id: string; name: string; dueDate: string | null; completedAt: string | null };
type TimeEntryInit = {
  id: string;
  minutes: number;
  note: string | null;
  loggedFor: string;
  user: Member;
  deliverable: { id: string; name: string } | null;
};

export function ProjectView({
  project,
  initialBoards,
  availableBoards,
  initialPhases,
  initialObjectives,
  initialAssessments,
  coverage,
  initialDeliverables,
  initialMilestones,
  initialTimeEntries,
  members,
  context,
}: {
  project: ProjectMeta;
  initialBoards: { id: string; name: string; columnCount: number }[];
  availableBoards: { id: string; name: string; columnCount: number }[];
  initialPhases: Phase[];
  initialObjectives: ObjectiveInit[];
  initialAssessments: AssessmentInit[];
  coverage: { totalScreens: number; orphanScreens: number };
  initialDeliverables: DeliverableInit[];
  initialMilestones: MilestoneInit[];
  initialTimeEntries: TimeEntryInit[];
  members: Member[];
  context: ProjectContext;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState(project.status);
  const [sprintsEnabled, setSprintsEnabled] = useState(project.sprintsEnabled);
  const [phases, setPhases] = useState<Phase[]>(initialPhases);
  const [, startTransition] = useTransition();
  useSetPageTitle(name);

  const done = phases.filter((p) => p.status === "done").length;

  function cycleStatus(p: Phase) {
    const next = NEXT_STATUS[p.status] ?? "not_started";
    setPhases((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: next } : x)));
    startTransition(() => void setPhaseStatus(p.id, next));
  }

  function renamePhaseLocal(id: string, value: string) {
    setPhases((prev) => prev.map((x) => (x.id === id ? { ...x, name: value } : x)));
  }

  function commitPhaseName(p: Phase, value: string) {
    // input is bound to the live phase name, so save whenever it's non-empty
    if (value.trim()) startTransition(() => void renamePhase(p.id, value.trim()));
  }

  function changeDate(p: Phase, which: "start" | "end", value: string) {
    const iso = value ? new Date(value).toISOString() : null;
    const startIso = which === "start" ? iso : p.startDate;
    const endIso = which === "end" ? iso : p.endDate;
    setPhases((prev) => prev.map((x) => (x.id === p.id ? { ...x, startDate: startIso, endDate: endIso } : x)));
    startTransition(() => void setPhaseDates(p.id, startIso, endIso));
  }

  function reorder(index: number, dir: -1 | 1) {
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= phases.length) return;
    const next = move(phases, index, newIndex);
    setPhases(next);
    startTransition(() => void movePhase(phases[index].id, newIndex));
  }

  function removePhase(id: string) {
    setPhases((prev) => prev.filter((x) => x.id !== id));
    startTransition(() => void deletePhase(id));
  }

  async function addPhase(phaseName: string) {
    const res = await createPhase(project.id, phaseName);
    if ("phase" in res && res.phase) {
      setPhases((prev) => [...prev, { ...res.phase, startDate: null, endDate: null }]);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={
          <InlineTitle
            value={name}
            onChange={setName}
            onCommit={() => {
              if (name.trim() && name !== project.name) startTransition(() => void renameProject(project.id, name));
            }}
            ariaLabel="Project name"
          />
        }
        actions={
          <>
            <StatusBadge tone="neutral">{project.methodology}</StatusBadge>
            {project.fromRequest && (
              <Link
                href={`/intake/${project.fromRequest.id}`}
                className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                title="The intake request this project came from"
              >
                <Inbox className="size-3.5" aria-hidden="true" />
                From {ticketLabel(project.fromRequest.number)}
              </Link>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sprintsEnabled}
                onChange={(e) => {
                  const next = e.target.checked;
                  setSprintsEnabled(next);
                  startTransition(() => void setProjectSprintsEnabled(project.id, next));
                }}
                className="size-4 rounded border-border-strong accent-accent"
              />
              <span className="text-muted-foreground">Sprint planning</span>
            </label>
            <span className="inline-flex w-36">
              <Select
                value={status}
                aria-label="Project status"
                className="h-8 py-1"
                onChange={(e) => {
                  setStatus(e.target.value);
                  startTransition(() => void setProjectStatus(project.id, e.target.value));
                }}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_LABEL[s as ProjectStatus]}
                  </option>
                ))}
              </Select>
            </span>
          </>
        }
      />

      <div className="mt-4">
        <ProjectContextStrip context={context} onProjectPage />
      </div>

      <Textarea aria-label="Project description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => updateProjectDescription(project.id, description)}
        placeholder="Add a project description…"
        rows={Math.min(10, Math.max(2, description.split("\n").length))}
        className="mt-4 resize-none"
      />

      <section id="phases" className="mt-8 scroll-mt-20">
        <SectionHeader
          action={
            phases.length > 0 && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span className="block h-full rounded-full bg-success" style={{ width: `${(done / phases.length) * 100}%` }} />
                </span>
                {done}/{phases.length} done
              </span>
            )
          }
        >
          Phases
        </SectionHeader>
        {phases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No phases yet. Add the first one below.</p>
        ) : (
          <ListPanel>
            {phases.map((p, i) => {
              const label = PHASE_STATUS_LABEL[p.status as PhaseStatus] ?? p.status;
              return (
                <li key={p.id} className="group flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                  <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground" aria-hidden="true">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => cycleStatus(p)}
                    title="Click to advance status"
                    aria-label={`Phase status: ${label}. Click to advance.`}
                    className="inline-flex h-6 shrink-0 items-center sm:w-28 gap-1.5 rounded-full border border-border px-2 text-xs font-medium outline-none hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <StatusDot category={PHASE_CATEGORY[p.status] ?? null} />
                    {label}
                  </button>
                  <div className="min-w-0 flex-1 basis-0 sm:basis-40">
                    <InlineTitle
                      value={p.name}
                      onChange={(v) => renamePhaseLocal(p.id, v)}
                      onCommit={() => commitPhaseName(p, p.name)}
                      ariaLabel="Phase name"
                      className={cn("text-sm font-medium tracking-normal", p.status === "done" && "text-muted-foreground")}
                    />
                  </div>
                  <div className="order-last flex w-full items-center gap-1 pl-8 text-xs text-muted-foreground sm:order-none sm:w-auto sm:pl-0">
                    <PhaseDate label="Phase start date" value={p.startDate} onChange={(v) => changeDate(p, "start", v)} />
                    <span aria-hidden="true">–</span>
                    <PhaseDate label="Phase end date" value={p.endDate} onChange={(v) => changeDate(p, "end", v)} />
                  </div>
                  <div className={ROW_ACTIONS}>
                    <Button variant="ghost" size="icon-xs" disabled={i === 0} onClick={() => reorder(i, -1)} title="Move up" aria-label="Move phase up">
                      <ChevronUp className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" disabled={i === phases.length - 1} onClick={() => reorder(i, 1)} title="Move down" aria-label="Move phase down">
                      <ChevronDown className="size-3.5" />
                    </Button>
                    <ConfirmDelete
                      title="Delete this phase?"
                      description="This permanently deletes the phase."
                      confirmLabel="Delete phase"
                      onConfirm={() => removePhase(p.id)}
                      trigger={
                        <Button variant="ghost" size="icon-xs" className="hover:bg-destructive/10 hover:text-destructive-ink" title="Delete phase" aria-label="Delete phase">
                          <X className="size-3.5" />
                        </Button>
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ListPanel>
        )}
        <PhaseComposer onAdd={addPhase} />
      </section>

      <BoardsSection projectId={project.id} initial={initialBoards} available={availableBoards} />

      <div id="alignment" className="scroll-mt-20" />
      <AlignmentSection
        projectId={project.id}
        initialObjectives={initialObjectives}
        initialAssessments={initialAssessments}
        coverage={coverage}
      />

      <DeliverablesSection
        projectId={project.id}
        phases={phases.map((p) => ({ id: p.id, name: p.name }))}
        members={members}
        initial={initialDeliverables}
      />

      <div id="milestones" className="scroll-mt-20" />
      <MilestonesSection projectId={project.id} initial={initialMilestones} />

      <TimeTracking
        projectId={project.id}
        deliverables={initialDeliverables.map((d) => ({ id: d.id, name: d.name }))}
        initial={initialTimeEntries}
      />

      <div className="mt-10 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <SaveAsTemplate kind="project" sourceId={project.id} sourceName={name} />
        <ConfirmDelete
          title="Delete this project?"
          description="This permanently deletes the project and all its phases, deliverables, milestones, and time entries."
          confirmLabel="Delete project"
          onConfirm={() => deleteProject(project.id)}
          trigger={
            <Button variant="ghost" className="text-destructive-ink hover:bg-destructive/10 hover:text-destructive-ink">
              Delete project
            </Button>
          }
        />
      </div>
    </PageContainer>
  );
}

function PhaseComposer({ onAdd }: { onAdd: (name: string) => void }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <AddRowButton onClick={() => setOpen(true)}>Add a phase</AddRowButton>
    );
  }

  function submit() {
    const v = value.trim();
    if (v) onAdd(v);
    setValue("");
    setOpen(false);
  }

  return (
    <div className="mt-2 flex gap-2">
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") { setValue(""); setOpen(false); }
        }}
        placeholder="Phase name…"
        className="flex-1"
      />
      <Button size="sm" onClick={submit}>Add</Button>
      <Button size="sm" variant="ghost" onClick={() => { setValue(""); setOpen(false); }}>Cancel</Button>
    </div>
  );
}
