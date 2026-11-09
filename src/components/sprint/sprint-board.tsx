"use client";

import { useMemo, useState, type ReactNode, useId } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, ListOrdered, Tag, User, X, Zap } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import { setCardStatus } from "@/app/actions/boards";
import { useSetPageTitle } from "@/components/app-shell/breadcrumbs";
import { CardDrawer, type CardFacePatch } from "@/components/board/card-drawer";
import { AddCardsDialog } from "@/components/sprint/add-cards-dialog";
import { CompleteSprintButton, StartSprintButton } from "@/components/sprint/sprint-lifecycle";
import { SavedViewsMenu } from "@/components/shared/saved-views-menu";
import { FilterChip } from "@/components/board/filter-bar";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { AvatarStack, DueChip, LabelPill, StatusDot, type StatusCategory } from "@/components/shared/work-item";
import { BlockedTag, EpicTag, EstimateChip, PriorityIcon, TypeIcon } from "@/components/shared/card-fields";
import { formatEstimate, type CardType, type EstimateUnit, type Priority } from "@/lib/card-fields";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { SavedViewDTO } from "@/app/actions/saved-views";
import type { SprintFilters } from "@/lib/saved-views";

type Person = { id: string; name: string | null; email: string };
export type SprintCard = {
  id: string;
  title: string;
  keySeq: number | null;
  statusId: string | null;
  dueDate: string | null;
  type: CardType;
  priority: Priority | null;
  estimate: number | null;
  epic?: { id: string; title: string } | null;
  blocked?: boolean;
  boardId: string;
  cardKeyPrefix: string | null;
  project: { id: string; name: string } | null;
  assignees: Person[];
  smes?: Person[];
  labels: LabelT[];
};
type StatusT = { id: string; name: string; category?: StatusCategory };
type LabelT = { id: string; name: string; color: string };

const NO_STATUS = "__none__";
const NO_PROJECT = "__noproject__";
const UNASSIGNED = "__unassigned__";
const NO_LABEL = "__nolabel__";
const NO_EPIC = "__noepic__";

export function SprintBoard({
  sprint,
  statuses,
  initialCards,
  estimateUnit = "points",
}: {
  estimateUnit?: EstimateUnit;
  sprint: {
    id: string;
    name: string;
    goal: string | null;
    status: string;
    startDate?: string | null;
    endDate?: string | null;
    /** "day N of M" for an active sprint — computed on the server (render stays pure). */
    progress?: string | null;
    /** A completed sprint's result ("8 of 10 cards done · …"). */
    reportLine?: string | null;
  };
  statuses: StatusT[];
  initialCards: SprintCard[];
}) {
  const [cards, setCards] = useState<SprintCard[]>(initialCards);
  const router = useRouter();
  const dndId = useId();
  const [projectFilter, setProjectFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [epicFilter, setEpicFilter] = useState("");
  // See board-view: the active view detaches as soon as a filter is hand-edited.
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<SprintCard | null>(null);
  useSetPageTitle(sprint.name);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleCardPatch(cardId: string, patch: CardFacePatch) {
    // An epic isn't planned in a sprint: making one leaves the sprint.
    if (patch.type === "epic") {
      setCards((cs) => cs.filter((c) => c.id !== cardId));
      return;
    }
    setCards((cs) =>
      cs.map((c) =>
        c.id === cardId
          ? {
              ...c,
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
              ...(patch.assignees !== undefined ? { assignees: patch.assignees } : {}),
              ...(patch.type !== undefined ? { type: patch.type } : {}),
              ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
              ...(patch.estimate !== undefined ? { estimate: patch.estimate } : {}),
              ...(patch.epic !== undefined ? { epic: patch.epic } : {}),
              ...(patch.blocked !== undefined ? { blocked: patch.blocked } : {}),
            }
          : c,
      ),
    );
  }

  function currentFilters() {
    return { project: projectFilter, assignee: assigneeFilter, label: labelFilter, epic: epicFilter };
  }

  function applyView(view: SavedViewDTO | null) {
    if (!view) {
      setProjectFilter("");
      setAssigneeFilter("");
      setLabelFilter("");
      setEpicFilter("");
      setActiveViewId(null);
      return;
    }
    const f = view.filters as SprintFilters;
    setProjectFilter(f.project);
    setAssigneeFilter(f.assignee);
    setLabelFilter(f.label);
    setEpicFilter(f.epic ?? "");
    setActiveViewId(view.id);
  }

  function handleCardDeleted(cardId: string) {
    setCards((cs) => cs.filter((c) => c.id !== cardId));
    setOpenCardId(null);
  }

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    let hasNone = false;
    cards.forEach((c) => (c.project ? map.set(c.project.id, c.project.name) : (hasNone = true)));
    return { list: [...map.entries()].sort((a, b) => a[1].localeCompare(b[1])), hasNone };
  }, [cards]);

  const people = useMemo(() => {
    const map = new Map<string, Person>();
    let hasUnassigned = false;
    cards.forEach((c) => (c.assignees.length ? c.assignees.forEach((a) => map.set(a.id, a)) : (hasUnassigned = true)));
    return { list: [...map.values()].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)), hasUnassigned };
  }, [cards]);

  // Labels are workspace-level, so a cross-project sprint board can finally filter by
  // them — the same label means the same thing on every project's board.
  const labels = useMemo(() => {
    const map = new Map<string, LabelT>();
    let hasNone = false;
    cards.forEach((c) => (c.labels.length ? c.labels.forEach((l) => map.set(l.id, l)) : (hasNone = true)));
    return { list: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)), hasNone };
  }, [cards]);

  const epics = useMemo(() => {
    const map = new Map<string, string>();
    let hasNone = false;
    cards.forEach((c) => (c.epic ? map.set(c.epic.id, c.epic.title) : (hasNone = true)));
    return { list: [...map.entries()].sort((a, b) => a[1].localeCompare(b[1])), hasNone };
  }, [cards]);

  const visible = useMemo(() => {
    return cards.filter((c) => {
      if (epicFilter) {
        if (epicFilter === NO_EPIC && c.epic) return false;
        if (epicFilter !== NO_EPIC && c.epic?.id !== epicFilter) return false;
      }
      if (projectFilter) {
        if (projectFilter === NO_PROJECT && c.project) return false;
        if (projectFilter !== NO_PROJECT && c.project?.id !== projectFilter) return false;
      }
      if (assigneeFilter) {
        if (assigneeFilter === UNASSIGNED && c.assignees.length) return false;
        if (assigneeFilter !== UNASSIGNED && !c.assignees.some((a) => a.id === assigneeFilter)) return false;
      }
      if (labelFilter) {
        if (labelFilter === NO_LABEL && c.labels.length) return false;
        if (labelFilter !== NO_LABEL && !c.labels.some((l) => l.id === labelFilter)) return false;
      }
      return true;
    });
  }, [cards, projectFilter, assigneeFilter, labelFilter, epicFilter]);

  const statusIds = useMemo(() => new Set(statuses.map((s) => s.id)), [statuses]);
  const needsNoStatus = visible.some((c) => !c.statusId || !statusIds.has(c.statusId));
  const columns = [
    ...statuses.map((s) => ({ id: s.id, name: s.name, droppable: true })),
    ...(needsNoStatus ? [{ id: NO_STATUS, name: "No status", droppable: false }] : []),
  ];

  const sum = (list: SprintCard[]) => list.reduce((n, c) => n + (c.estimate ?? 0), 0);
  const doneIds = useMemo(() => new Set(statuses.filter((s) => s.category === "done").map((s) => s.id)), [statuses]);
  const estimated = visible.some((c) => c.estimate != null);
  const totalEstimate = sum(visible);
  const doneEstimate = sum(visible.filter((c) => c.statusId && doneIds.has(c.statusId)));

  function cardsFor(statusId: string) {
    if (statusId === NO_STATUS) return visible.filter((c) => !c.statusId || !statusIds.has(c.statusId));
    return visible.filter((c) => c.statusId === statusId);
  }

  async function changeStatus(card: SprintCard, statusId: string) {
    const prev = card.statusId;
    if (prev === statusId) return;
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, statusId } : c)));
    const res = await setCardStatus(card.id, statusId);
    if (res && "error" in res && res.error) {
      setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, statusId: prev } : c)));
    }
  }

  function onDragStart(e: DragStartEvent) {
    setActiveCard(cards.find((c) => c.id === String(e.active.id)) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    if (!statusIds.has(overId)) return; // dropped outside a status column (e.g. "No status") — ignore
    const card = cards.find((c) => c.id === String(active.id));
    if (card) changeStatus(card, overId);
  }

  const filtersActive = !!(projectFilter || assigneeFilter || labelFilter || epicFilter);
  const navIds = columns.flatMap((col) => cardsFor(col.id).map((c) => c.id));
  const navIndex = openCardId ? navIds.indexOf(openCardId) : -1;
  const openCard = openCardId ? cards.find((c) => c.id === openCardId) ?? null : null;

  const projectName = (id: string) =>
    id === NO_PROJECT ? "No project" : projects.list.find(([pid]) => pid === id)?.[1] ?? null;
  const personName = (id: string) =>
    id === UNASSIGNED ? "Unassigned" : (() => {
      const p = people.list.find((x) => x.id === id);
      return p ? p.name ?? p.email : null;
    })();
  const labelName = (id: string) => (id === NO_LABEL ? "No label" : labels.list.find((l) => l.id === id)?.name ?? null);

  return (
    <div className="flex h-full min-h-screen min-w-0 flex-col gap-4 px-6 pt-5 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[12rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{sprint.name}</h1>
            <StatusBadge tone={SPRINT_TONE[sprint.status] ?? "neutral"}>{SPRINT_LABEL[sprint.status] ?? sprint.status}</StatusBadge>
          </div>
          <SprintMeta goal={sprint.goal} startDate={sprint.startDate ?? null} endDate={sprint.endDate ?? null} progress={sprint.progress ?? null} />
          {sprint.reportLine && <p className="mt-1 text-sm text-muted-foreground">{sprint.reportLine}</p>}
          {estimated && !sprint.reportLine && (
            <p className="mt-1 text-sm text-muted-foreground">
              {Math.round(doneEstimate * 100) / 100} of {formatEstimate(totalEstimate, estimateUnit)} done
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/sprints/backlog" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-hover hover:text-foreground">
            <ListOrdered className="size-4" aria-hidden="true" />
            Backlog
          </Link>
          {sprint.status === "planned" && (
            <StartSprintButton
              sprint={{ id: sprint.id, name: sprint.name, goal: sprint.goal, startDate: sprint.startDate?.slice(0, 10) ?? null, endDate: sprint.endDate?.slice(0, 10) ?? null }}
              cardCount={cards.length}
              estimate={sum(cards)}
              estimateUnit={estimateUnit}
              onStarted={() => router.refresh()}
            />
          )}
          {sprint.status === "active" && <CompleteSprintButton sprintId={sprint.id} estimateUnit={estimateUnit} onCompleted={() => router.refresh()} />}
          {sprint.status !== "completed" && <AddCardsDialog sprintId={sprint.id} onAdded={(card) => setCards((cs) => [card, ...cs])} />}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <SingleSelectChip
          icon={<FolderKanban className="size-3.5" />}
          label="Project"
          value={projectFilter}
          current={projectFilter ? projectName(projectFilter) : null}
          options={[
            ...projects.list.map(([id, name]) => ({ id, name })),
            ...(projects.hasNone ? [{ id: NO_PROJECT, name: "No project" }] : []),
          ]}
          onChange={(v) => { setActiveViewId(null); setProjectFilter(v); }}
        />
        <SingleSelectChip
          icon={<User className="size-3.5" />}
          label="Assignee"
          value={assigneeFilter}
          current={assigneeFilter ? personName(assigneeFilter) : null}
          options={[
            ...people.list.map((p) => ({ id: p.id, name: p.name ?? p.email })),
            ...(people.hasUnassigned ? [{ id: UNASSIGNED, name: "Unassigned" }] : []),
          ]}
          onChange={(v) => { setActiveViewId(null); setAssigneeFilter(v); }}
        />
        <SingleSelectChip
          icon={<Tag className="size-3.5" />}
          label="Label"
          value={labelFilter}
          current={labelFilter ? labelName(labelFilter) : null}
          options={[
            ...labels.list.map((l) => ({ id: l.id, name: l.name, color: l.color })),
            ...(labels.hasNone ? [{ id: NO_LABEL, name: "No label" }] : []),
          ]}
          onChange={(v) => { setActiveViewId(null); setLabelFilter(v); }}
        />
        <SingleSelectChip
          icon={<Zap className="size-3.5" />}
          label="Epic"
          value={epicFilter}
          current={epicFilter ? (epicFilter === NO_EPIC ? "No epic" : epics.list.find(([id]) => id === epicFilter)?.[1] ?? null) : null}
          options={[
            ...epics.list.map(([id, name]) => ({ id, name })),
            ...(epics.hasNone ? [{ id: NO_EPIC, name: "No epic" }] : []),
          ]}
          onChange={(v) => { setActiveViewId(null); setEpicFilter(v); }}
        />
        {filtersActive && (
          <>
            <Button variant="ghost" size="sm" onClick={() => applyView(null)} className="h-8 text-muted-foreground">
              <X className="size-3.5" aria-hidden="true" />
              Clear
            </Button>
            <span className="text-xs text-muted-foreground" aria-live="polite">{visible.length} of {cards.length} cards</span>
          </>
        )}
        <span className="flex-1" />
        <SavedViewsMenu
          scope="sprint"
          currentFilters={currentFilters}
          filtersActive={filtersActive}
          activeViewId={activeViewId}
          onApply={applyView}
        />
      </div>

      {cards.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          No cards assigned yet. Open any board, click a card, and set its{" "}
          <span className="font-medium text-foreground">Sprint</span> field to this sprint — it&rsquo;ll appear here.
        </p>
      )}

      {columns.length > 0 && (
        <DndContext id={dndId} sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          {/* `relative`: keeps the cards' sr-only text from widening the page (see board-view). */}
          <div className="relative -mx-6 flex min-w-0 flex-1 items-start gap-3 overflow-x-auto px-6 pb-2">
            {columns.map((col) => (
              <StatusColumn
                key={col.id}
                id={col.id}
                name={col.name}
                category={statuses.find((s) => s.id === col.id)?.category ?? null}
                droppable={col.droppable}
                count={cardsFor(col.id).length}
                estimate={estimated ? formatEstimate(sum(cardsFor(col.id)), estimateUnit) : null}
              >
                {cardsFor(col.id).map((c) => (
                  <SprintCardCell key={c.id} card={c} estimateUnit={estimateUnit} selected={c.id === openCardId} onOpen={() => setOpenCardId(c.id)} />
                ))}
                {cardsFor(col.id).length === 0 && <p className="px-1.5 py-2 text-xs text-muted-foreground">No cards</p>}
              </StatusColumn>
            ))}
          </div>

          <DragOverlay>
            {activeCard ? (
              <div className="w-64 rotate-1 rounded-lg border border-border bg-surface p-3 text-sm font-semibold shadow-lg">
                {activeCard.title}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {openCardId && (
        <CardDrawer
          cardId={openCardId}
          onClose={() => setOpenCardId(null)}
          onPatch={handleCardPatch}
          onDeleted={handleCardDeleted}
          onNavigate={(id) => setOpenCardId(id)}
          // The sprint board moves cards by canonical status rather than board column,
          // so the panel's Status picker lists statuses (the non-drag move, WCAG 2.5.7).
          columns={statuses.map((s) => ({ id: s.id, name: s.name }))}
          currentColumnId={openCard && statusIds.has(openCard.statusId ?? "") ? openCard.statusId : null}
          onMoveToColumn={(statusId) => openCard && changeStatus(openCard, statusId)}
          position={navIndex >= 0 ? { index: navIndex, total: navIds.length } : null}
          onStep={(dir) => {
            const next = navIds[navIndex + dir];
            if (next) setOpenCardId(next);
          }}
        />
      )}
    </div>
  );
}

const SPRINT_LABEL: Record<string, string> = { planned: "Planned", active: "Active", completed: "Completed" };
const SPRINT_TONE: Record<string, StatusTone> = { planned: "neutral", active: "info", completed: "success" };

function SprintMeta({
  goal,
  startDate,
  endDate,
  progress,
}: {
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  progress: string | null;
}) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
      {startDate && endDate && (
        <span>
          {fmt(startDate)} – {fmt(endDate)}
          {progress && <> · {progress}</>}
        </span>
      )}
      {goal && <span className="text-foreground/80">{startDate && endDate ? "· " : ""}{goal}</span>}
    </p>
  );
}

/** A filter chip with a single-choice menu ("" = no filter). */
export function SingleSelectChip({
  icon,
  label,
  value,
  current,
  options,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  current: string | null;
  options: { id: string; name: string; color?: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterChip icon={icon} label={label} current={current} disabled={options.length === 0} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          <DropdownMenuRadioItem value="">Any {label.toLowerCase()}</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.id} value={o.id}>
              {o.color && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} aria-hidden="true" />}
              <span className="truncate">{o.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusColumn({
  id,
  name,
  category,
  droppable,
  count,
  estimate,
  children,
}: {
  id: string;
  name: string;
  category: StatusCategory;
  droppable: boolean;
  count: number;
  /** The column's estimate total ("8 pts"), when any card in the sprint has one. */
  estimate: string | null;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable });
  return (
    <section
      aria-label={name}
      ref={droppable ? setNodeRef : undefined}
      className={cn(
        "flex min-w-[12.5rem] max-w-[22rem] flex-1 shrink-0 flex-col gap-2 rounded-lg p-2 transition-colors",
        isOver ? "bg-accent/10 ring-1 ring-accent/40" : "bg-surface-muted",
      )}
    >
      <div className="flex items-center gap-2 px-1.5 py-1">
        <StatusDot category={category} />
        <h2 className="flex-1 text-sm font-semibold">{name}</h2>
        <span className="text-xs font-medium text-muted-foreground">
          {count}
          {estimate && <> · {estimate}</>}
        </span>
      </div>
      {children}
    </section>
  );
}

function SprintCardCell({
  card,
  estimateUnit,
  selected,
  onOpen,
}: {
  card: SprintCard;
  estimateUnit: EstimateUnit;
  selected: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  const key = card.cardKeyPrefix && card.keySeq != null ? `${card.cardKeyPrefix}-${card.keySeq}` : null;
  const hasPeople = card.assignees.length > 0 || (card.smes?.length ?? 0) > 0;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-roledescription="draggable card"
      onClick={onOpen}
      className={cn(
        "relative flex flex-col gap-2 rounded-lg border bg-surface p-3 text-sm shadow-xs",
        selected ? "border-accent ring-1 ring-accent" : "border-border hover:shadow-sm",
        isDragging ? "opacity-40" : "cursor-pointer active:cursor-grabbing",
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <TypeIcon type={card.type} />
          {key && <span className="shrink-0 font-mono font-medium">{key}</span>}
          {card.priority && <PriorityIcon priority={card.priority} />}
          {card.project && <span className="truncate" title={`Project: ${card.project.name}`}>{card.project.name}</span>}
        </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="-m-0.5 rounded p-0.5 text-left font-semibold leading-5 break-words outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {card.title}
      </button>
      {(card.epic || card.blocked) && (
        <span className="flex flex-wrap gap-1">
          {card.blocked && <BlockedTag />}
          {card.epic && <EpicTag title={card.epic.title} />}
        </span>
      )}
      {card.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <LabelPill key={l.id} label={l} />
          ))}
        </div>
      )}
      {(card.dueDate || card.estimate != null || hasPeople) && (
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
          {card.estimate != null && <EstimateChip estimate={card.estimate} unit={estimateUnit} />}
          {card.dueDate && <DueChip iso={card.dueDate} />}
          {hasPeople && (
            <span className="ml-auto">
              <AvatarStack assignees={card.assignees} smes={card.smes ?? []} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
