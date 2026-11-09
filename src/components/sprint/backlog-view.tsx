"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  Flag,
  MoreHorizontal,
  Plus,
  Search,
  Shapes,
  Tag,
  User,
  X,
  Zap,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { planCard } from "@/app/actions/backlog";
import { setCardStatus } from "@/app/actions/boards";
import { createSprint } from "@/app/actions/sprints";
import { useSetPageTitle } from "@/components/app-shell/breadcrumbs";
import { CardDrawer, type CardFacePatch } from "@/components/board/card-drawer";
import { SingleSelectChip } from "@/components/sprint/sprint-board";
import { CompleteSprintButton, StartSprintButton } from "@/components/sprint/sprint-lifecycle";
import { BlockedTag, EpicTag, EstimateChip, PriorityIcon, TypeIcon } from "@/components/shared/card-fields";
import { PageHeader } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status-badge";
import { AvatarStack, LabelPill, StatusDot, type StatusCategory } from "@/components/shared/work-item";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BacklogCard, BacklogSprint } from "@/lib/backlog";
import {
  CARD_TYPES,
  CARD_TYPE_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  formatEstimate,
  type EstimateUnit,
} from "@/lib/card-fields";
import { nextSprintName } from "@/lib/sprint";
import { cn } from "@/lib/utils";

// The Backlog (docs/JIRA-PARITY.md, phase 4): active and planned sprints, then every
// open card with no sprint, in one order across boards. Drag a card within or between
// sections to plan; each card's menu does the same without dragging (WCAG 2.5.7).

const BACKLOG = "__backlog__";
const SECTION = "section:";
const NONE = "__none__";

type StatusT = { id: string; name: string; category: StatusCategory };
type EpicT = { id: string; title: string; key: string | null; progress: { done: number; total: number } };
type Person = { id: string; name: string | null; email: string };

const sectionOf = (c: BacklogCard) => c.sprintId ?? BACKLOG;

/** Active sprints first (earliest start first), then planned ones in their existing order. */
function sortSprints(list: BacklogSprint[]) {
  const active = list.filter((s) => s.status === "active").sort((a, b) => (a.startDate ?? "9").localeCompare(b.startDate ?? "9"));
  return [...active, ...list.filter((s) => s.status === "planned")];
}

function fmtDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function BacklogView({
  sprints: initialSprints,
  initialCards,
  hiddenBacklog,
  statuses,
  epics,
  estimateUnit,
}: {
  sprints: BacklogSprint[];
  initialCards: BacklogCard[];
  hiddenBacklog: number;
  statuses: StatusT[];
  epics: EpicT[];
  estimateUnit: EstimateUnit;
}) {
  const router = useRouter();
  const dndId = useId();
  const [sprints, setSprints] = useState(() => sortSprints(initialSprints));
  const [cards, setCards] = useState(initialCards);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [showEpics, setShowEpics] = useState(true);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [epicFilter, setEpicFilter] = useState("");

  useSetPageTitle("Backlog");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);

  // ── Filter options, from the cards on the page ──
  const people = useMemo(() => {
    const map = new Map<string, Person>();
    cards.forEach((c) => c.assignees.forEach((a) => map.set(a.id, a)));
    return [...map.values()].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  }, [cards]);
  const labels = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string }>();
    cards.forEach((c) => c.labels.forEach((l) => map.set(l.id, l)));
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [cards]);
  const projects = useMemo(() => {
    const map = new Map<string, string>();
    cards.forEach((c) => c.project && map.set(c.project.id, c.project.name));
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [cards]);

  const q = query.trim().toLowerCase();
  const matches = (c: BacklogCard) => {
    if (q) {
      const key = c.cardKeyPrefix && c.keySeq != null ? `${c.cardKeyPrefix}-${c.keySeq}`.toLowerCase() : "";
      if (!c.title.toLowerCase().includes(q) && !key.includes(q)) return false;
    }
    if (typeFilter && c.type !== typeFilter) return false;
    if (priorityFilter && (priorityFilter === NONE ? c.priority : c.priority !== priorityFilter)) return false;
    if (assigneeFilter && (assigneeFilter === NONE ? c.assignees.length : !c.assignees.some((a) => a.id === assigneeFilter))) return false;
    if (labelFilter && (labelFilter === NONE ? c.labels.length : !c.labels.some((l) => l.id === labelFilter))) return false;
    if (projectFilter && (projectFilter === NONE ? c.project : c.project?.id !== projectFilter)) return false;
    if (epicFilter && (epicFilter === NONE ? c.epic : c.epic?.id !== epicFilter)) return false;
    return true;
  };
  const filtersActive = !!(q || typeFilter || priorityFilter || assigneeFilter || labelFilter || projectFilter || epicFilter);
  const visible = cards.filter(matches);
  const sectionKeys = [...sprints.map((s) => s.id), BACKLOG];
  const visibleIn = (key: string) => visible.filter((c) => sectionOf(c) === key);
  const allIn = (key: string) => cards.filter((c) => sectionOf(c) === key);

  function clearFilters() {
    setQuery("");
    setTypeFilter("");
    setPriorityFilter("");
    setAssigneeFilter("");
    setLabelFilter("");
    setProjectFilter("");
    setEpicFilter("");
  }

  // ── Planning ──

  /** Persist a card's place: its section, between its visible neighbours there. */
  async function persist(cardId: string, list: BacklogCard[]) {
    const card = list.find((c) => c.id === cardId);
    if (!card) return;
    const section = list.filter((c) => sectionOf(c) === sectionOf(card) && (c.id === cardId || matches(c)));
    const i = section.findIndex((c) => c.id === cardId);
    const res = await planCard(cardId, card.sprintId, section[i - 1]?.id ?? null, section[i + 1]?.id ?? null);
    if ("error" in res) {
      setNotice({ tone: "error", text: res.error ?? "Couldn’t move the card." });
      router.refresh();
      setCards(initialCards);
    }
  }

  /** Move a card to the top or bottom of a section (the menu's non-drag path). */
  function moveTo(cardId: string, key: string, where: "top" | "bottom") {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    const moved = { ...card, sprintId: key === BACKLOG ? null : key };
    const rest = cards.filter((c) => c.id !== cardId);
    const inSection = rest.filter((c) => sectionOf(c) === key && matches(c));
    let next: BacklogCard[];
    if (where === "top" && inSection.length) {
      const at = rest.indexOf(inSection[0]);
      next = [...rest.slice(0, at), moved, ...rest.slice(at)];
    } else if (inSection.length) {
      const at = rest.indexOf(inSection[inSection.length - 1]) + 1;
      next = [...rest.slice(0, at), moved, ...rest.slice(at)];
    } else {
      next = [...rest, moved];
    }
    setCards(next);
    void persist(cardId, next);
  }

  const collision: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    const onCards = hits.filter((h) => !String(h.id).startsWith(SECTION));
    if (onCards.length) return onCards;
    if (hits.length) return hits;
    return closestCenter(args);
  };

  const keyOfOver = (overId: string, list: BacklogCard[]) =>
    overId.startsWith(SECTION) ? overId.slice(SECTION.length) : (list.find((c) => c.id === overId) && sectionOf(list.find((c) => c.id === overId)!)) || null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setNotice(null);
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const id = String(active.id);
    const overId = String(over.id);
    setCards((prev) => {
      const card = prev.find((c) => c.id === id);
      const to = keyOfOver(overId, prev);
      if (!card || !to || to === sectionOf(card)) return prev;
      const moved = { ...card, sprintId: to === BACKLOG ? null : to };
      const rest = prev.filter((c) => c.id !== id);
      const at = overId.startsWith(SECTION) ? -1 : rest.findIndex((c) => c.id === overId);
      return at < 0 ? [...rest, moved] : [...rest.slice(0, at), moved, ...rest.slice(at)];
    });
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) {
      setCards(initialCards);
      router.refresh();
      return;
    }
    const id = String(active.id);
    const overId = String(over.id);
    let next = cards;
    if (!overId.startsWith(SECTION) && overId !== id) {
      const from = next.findIndex((c) => c.id === id);
      const to = next.findIndex((c) => c.id === overId);
      if (from >= 0 && to >= 0 && sectionOf(next[from]) === sectionOf(next[to])) {
        const copy = [...next];
        const [m] = copy.splice(from, 1);
        copy.splice(to, 0, m);
        next = copy;
        setCards(next);
      }
    }
    void persist(id, next);
  }

  // ── Sprints ──

  async function addSprint() {
    const last = sprints[sprints.length - 1];
    const name = last ? nextSprintName(last.name) : "Sprint 1";
    const res = await createSprint(name);
    if ("error" in res || !res.sprint) {
      setNotice({ tone: "error", text: ("error" in res && res.error) || "Couldn’t create the sprint." });
      return;
    }
    const s = res.sprint;
    setSprints((list) => [...list, { id: s.id, name: s.name, goal: s.goal, status: "planned", startDate: null, endDate: null, report: {} }]);
  }

  function onStarted(id: string, s: { name: string; goal: string | null; startDate: string; endDate: string }) {
    setSprints((list) => sortSprints(list.map((x) => (x.id === id ? { ...x, ...s, status: "active" as const } : x))));
    setNotice({ tone: "info", text: `${s.name} started.` });
  }

  function onCompleted(id: string, r: { movedTo: { id: string; name: string } | null; created: boolean }) {
    const name = sprints.find((s) => s.id === id)?.name ?? "Sprint";
    const moved = cards.filter((c) => c.sprintId === id && !c.done).length;
    setCards((list) =>
      list.filter((c) => !(c.sprintId === id && c.done)).map((c) => (c.sprintId === id ? { ...c, sprintId: r.movedTo?.id ?? null } : c)),
    );
    setSprints((list) => {
      const rest = list.filter((s) => s.id !== id);
      return r.created && r.movedTo
        ? [...rest, { id: r.movedTo.id, name: r.movedTo.name, goal: null, status: "planned" as const, startDate: null, endDate: null, report: {} }]
        : rest;
    });
    setNotice({
      tone: "info",
      text: `${name} completed.${moved ? ` ${moved} unfinished ${moved === 1 ? "card" : "cards"} moved to ${r.movedTo?.name ?? "the backlog"}.` : ""}`,
    });
  }

  // ── Card panel ──

  function handleCardPatch(cardId: string, patch: CardFacePatch) {
    if (patch.type === "epic") {
      setCards((cs) => cs.filter((c) => c.id !== cardId));
      setOpenCardId(null);
      return;
    }
    setCards((cs) =>
      cs.map((c) => {
        if (c.id !== cardId) return c;
        const n = { ...c };
        if (patch.title !== undefined) n.title = patch.title;
        if (patch.dueDate !== undefined) n.dueDate = patch.dueDate;
        if (patch.assignees !== undefined) n.assignees = patch.assignees;
        if (patch.labels !== undefined) n.labels = patch.labels;
        if (patch.type !== undefined) n.type = patch.type;
        if (patch.priority !== undefined) n.priority = patch.priority;
        if (patch.estimate !== undefined) n.estimate = patch.estimate;
        if (patch.epic !== undefined) n.epic = patch.epic ? { id: patch.epic.id, title: patch.epic.title } : null;
        if (patch.blocked !== undefined) n.blocked = patch.blocked;
        if (patch.sprintId !== undefined && (patch.sprintId === null || sprints.some((s) => s.id === patch.sprintId))) n.sprintId = patch.sprintId;
        return n;
      }),
    );
  }

  async function changeStatus(card: BacklogCard, statusId: string) {
    if (card.statusId === statusId) return;
    const prev = { statusId: card.statusId, done: card.done };
    const done = statusById.get(statusId)?.category === "done";
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, statusId, done } : c)));
    const res = await setCardStatus(card.id, statusId);
    if (res && "error" in res && res.error) setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, ...prev } : c)));
  }

  const navIds = sectionKeys.flatMap((k) => (collapsed.has(k) ? [] : visibleIn(k).map((c) => c.id)));
  const navIndex = openCardId ? navIds.indexOf(openCardId) : -1;
  const openCard = openCardId ? cards.find((c) => c.id === openCardId) ?? null : null;
  const activeCard = activeId ? cards.find((c) => c.id === activeId) ?? null : null;
  const sum = (list: BacklogCard[]) => list.reduce((n, c) => n + (c.estimate ?? 0), 0);
  const sectionChoices = [...sprints.map((s) => ({ key: s.id, name: s.name })), { key: BACKLOG, name: "Backlog" }];

  function toggle(key: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  return (
    <div className="flex min-h-screen min-w-0 flex-col gap-4 px-4 pt-5 pb-10 sm:px-6">
      <PageHeader
        title="Backlog"
        description="Rank work across every board, plan it into sprints, then start and complete them."
        actions={
          <span className="flex items-center gap-4">
            <Link href="/sprints/roadmap" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline">
              Roadmap <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
            <Link href="/sprints" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline">
              All sprints <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </span>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30 sm:w-56">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">Search the backlog</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or key"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <SingleSelectChip
          icon={<Shapes className="size-3.5" />}
          label="Type"
          value={typeFilter}
          current={typeFilter ? CARD_TYPE_LABEL[typeFilter as keyof typeof CARD_TYPE_LABEL] : null}
          options={CARD_TYPES.filter((t) => t !== "epic").map((t) => ({ id: t, name: CARD_TYPE_LABEL[t] }))}
          onChange={setTypeFilter}
        />
        <SingleSelectChip
          icon={<Flag className="size-3.5" />}
          label="Priority"
          value={priorityFilter}
          current={priorityFilter ? (priorityFilter === NONE ? "No priority" : PRIORITY_LABEL[priorityFilter as keyof typeof PRIORITY_LABEL]) : null}
          options={[...PRIORITIES.map((p) => ({ id: p, name: PRIORITY_LABEL[p] })), { id: NONE, name: "No priority" }]}
          onChange={setPriorityFilter}
        />
        <SingleSelectChip
          icon={<User className="size-3.5" />}
          label="Assignee"
          value={assigneeFilter}
          current={assigneeFilter ? (assigneeFilter === NONE ? "Unassigned" : people.find((p) => p.id === assigneeFilter)?.name ?? people.find((p) => p.id === assigneeFilter)?.email ?? null) : null}
          options={[...people.map((p) => ({ id: p.id, name: p.name ?? p.email })), { id: NONE, name: "Unassigned" }]}
          onChange={setAssigneeFilter}
        />
        <SingleSelectChip
          icon={<Tag className="size-3.5" />}
          label="Label"
          value={labelFilter}
          current={labelFilter ? (labelFilter === NONE ? "No label" : labels.find((l) => l.id === labelFilter)?.name ?? null) : null}
          options={[...labels.map((l) => ({ id: l.id, name: l.name, color: l.color })), { id: NONE, name: "No label" }]}
          onChange={setLabelFilter}
        />
        <SingleSelectChip
          icon={<FolderKanban className="size-3.5" />}
          label="Project"
          value={projectFilter}
          current={projectFilter ? (projectFilter === NONE ? "No project" : projects.find((p) => p.id === projectFilter)?.name ?? null) : null}
          options={[...projects, { id: NONE, name: "No project" }]}
          onChange={setProjectFilter}
        />
        {filtersActive && (
          <>
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-muted-foreground">
              <X className="size-3.5" aria-hidden="true" />
              Clear
            </Button>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {visible.length} of {cards.length} cards
            </span>
          </>
        )}
        {/* Narrow screens filter by epic with a chip; wide ones have the Epics panel. */}
        <span className="lg:hidden">
          <SingleSelectChip
            icon={<Zap className="size-3.5" />}
            label="Epic"
            value={epicFilter}
            current={epicFilter ? (epicFilter === NONE ? "No epic" : epics.find((e) => e.id === epicFilter)?.title ?? null) : null}
            options={[...epics.map((e) => ({ id: e.id, name: e.title })), { id: NONE, name: "No epic" }]}
            onChange={setEpicFilter}
          />
        </span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" className="hidden h-8 lg:inline-flex" aria-pressed={showEpics} onClick={() => setShowEpics((v) => !v)}>
          <Zap className="size-3.5" aria-hidden="true" />
          {showEpics ? "Hide epics" : "Epics"}
        </Button>
      </div>

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
            notice.tone === "error" ? "border-destructive/30 bg-destructive/5 text-destructive-ink" : "border-border bg-surface-muted",
          )}
        >
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </p>
      )}

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
        {showEpics && (
          <EpicPanel
            epics={epics}
            value={epicFilter}
            onChange={setEpicFilter}
            hasNoEpic={cards.some((c) => !c.epic)}
          />
        )}

        <DndContext id={dndId} sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {sprints.map((s) => {
              const list = visibleIn(s.id);
              const all = allIn(s.id);
              return (
                <Section
                  key={s.id}
                  id={s.id}
                  collapsed={collapsed.has(s.id)}
                  onToggle={() => toggle(s.id)}
                  title={s.name}
                  badge={s.status === "active" ? <StatusBadge tone="info">Active</StatusBadge> : null}
                  meta={
                    <>
                      {s.startDate && s.endDate && <span>{fmtDay(s.startDate)} – {fmtDay(s.endDate)}</span>}
                      <span>
                        {filtersActive ? `${list.length} of ${all.length}` : all.length} {all.length === 1 ? "card" : "cards"}
                        {sum(all) > 0 && <> · {formatEstimate(sum(filtersActive ? list : all), estimateUnit)}</>}
                      </span>
                    </>
                  }
                  goal={s.goal}
                  actions={
                    <>
                      <Link href={`/sprints/${s.id}`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-hover hover:text-foreground">
                        Sprint board <ArrowRight className="size-3" aria-hidden="true" />
                      </Link>
                      {s.status === "active" && (
                        <Link href={`/sprints/${s.id}/report`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-hover hover:text-foreground">
                          Report
                        </Link>
                      )}
                      {s.status === "active" ? (
                        <CompleteSprintButton size="xs" sprintId={s.id} estimateUnit={estimateUnit} onCompleted={(r) => onCompleted(s.id, r)} />
                      ) : (
                        <StartSprintButton
                          size="xs"
                          sprint={s}
                          cardCount={all.length}
                          estimate={sum(all)}
                          estimateUnit={estimateUnit}
                          onStarted={(x) => onStarted(s.id, x)}
                        />
                      )}
                    </>
                  }
                  count={list.length}
                  empty={all.length === 0 ? "Plan this sprint by dragging cards here from the backlog." : "No cards match the filters."}
                >
                  <Rows
                    list={list}
                    statusById={statusById}
                    estimateUnit={estimateUnit}
                    openCardId={openCardId}
                    onOpen={setOpenCardId}
                    sections={sectionChoices}
                    currentKey={s.id}
                    onMove={moveTo}
                  />
                </Section>
              );
            })}

            {(() => {
              const list = visibleIn(BACKLOG);
              const all = allIn(BACKLOG);
              return (
                <Section
                  id={BACKLOG}
                  collapsed={collapsed.has(BACKLOG)}
                  onToggle={() => toggle(BACKLOG)}
                  title="Backlog"
                  meta={
                    <span>
                      {filtersActive ? `${list.length} of ${all.length}` : all.length + hiddenBacklog} {all.length + hiddenBacklog === 1 ? "card" : "cards"}
                      {sum(all) > 0 && <> · {formatEstimate(sum(filtersActive ? list : all), estimateUnit)}</>}
                    </span>
                  }
                  actions={
                    <Button size="xs" variant="outline" onClick={addSprint}>
                      <Plus className="size-3.5" aria-hidden="true" />
                      Create sprint
                    </Button>
                  }
                  count={list.length}
                  empty={all.length === 0 ? "Nothing in the backlog. Open cards with no sprint show up here." : "No cards match the filters."}
                  footer={
                    hiddenBacklog > 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        {hiddenBacklog} more {hiddenBacklog === 1 ? "card isn’t" : "cards aren’t"} shown. Plan the ones above, or open a board to find them.
                      </p>
                    ) : null
                  }
                >
                  <Rows
                    list={list}
                    statusById={statusById}
                    estimateUnit={estimateUnit}
                    openCardId={openCardId}
                    onOpen={setOpenCardId}
                    sections={sectionChoices}
                    currentKey={BACKLOG}
                    onMove={moveTo}
                  />
                </Section>
              );
            })()}
          </div>

          <DragOverlay>
            {activeCard ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium shadow-lg">
                <TypeIcon type={activeCard.type} />
                <span className="truncate">{activeCard.title}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {openCardId && (
        <CardDrawer
          cardId={openCardId}
          onClose={() => setOpenCardId(null)}
          onPatch={handleCardPatch}
          onDeleted={(id) => {
            setCards((cs) => cs.filter((c) => c.id !== id));
            setOpenCardId(null);
          }}
          onNavigate={(id) => setOpenCardId(id)}
          columns={statuses.map((s) => ({ id: s.id, name: s.name }))}
          currentColumnId={openCard?.statusId && statusById.has(openCard.statusId) ? openCard.statusId : null}
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

function Section({
  id,
  title,
  badge,
  meta,
  goal,
  actions,
  collapsed,
  onToggle,
  empty,
  footer,
  count,
  children,
}: {
  id: string;
  title: string;
  badge?: ReactNode;
  meta: ReactNode;
  goal?: string | null;
  actions: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  empty: string;
  footer?: ReactNode;
  /** How many rows the section shows (0 = its empty message). */
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${SECTION}${id}` });
  const headingId = `backlog-section-${id}`;
  return (
    <section aria-labelledby={headingId} className={cn("rounded-lg border border-border bg-surface-muted transition-colors", isOver && "ring-1 ring-accent/40")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="-ml-1 flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-hover"
        >
          {collapsed ? <ChevronRight className="size-4 shrink-0" aria-hidden="true" /> : <ChevronDown className="size-4 shrink-0" aria-hidden="true" />}
          <h2 id={headingId} className="truncate text-sm font-semibold">
            {title}
          </h2>
        </button>
        {badge}
        <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">{meta}</span>
        <span className="flex-1" />
        <div className="flex items-center gap-1">{actions}</div>
        {goal && <p className="w-full pl-6 text-xs text-muted-foreground">{goal}</p>}
      </div>
      {!collapsed && (
        <div ref={setNodeRef} className="min-h-10 border-t border-border bg-surface">
          {count === 0 ? <p className="px-3 py-3 text-xs text-muted-foreground">{empty}</p> : children}
          {footer}
        </div>
      )}
    </section>
  );
}

function Rows({
  list,
  statusById,
  estimateUnit,
  openCardId,
  onOpen,
  sections,
  currentKey,
  onMove,
}: {
  list: BacklogCard[];
  statusById: Map<string, StatusT>;
  estimateUnit: EstimateUnit;
  openCardId: string | null;
  onOpen: (id: string) => void;
  sections: { key: string; name: string }[];
  currentKey: string;
  onMove: (cardId: string, key: string, where: "top" | "bottom") => void;
}) {
  return (
    <SortableContext items={list.map((c) => c.id)} strategy={verticalListSortingStrategy}>
      <ul className="flex flex-col divide-y divide-border">
        {list.map((c) => (
          <Row
            key={c.id}
            card={c}
            status={c.statusId ? statusById.get(c.statusId) ?? null : null}
            estimateUnit={estimateUnit}
            selected={c.id === openCardId}
            onOpen={() => onOpen(c.id)}
            sections={sections}
            currentKey={currentKey}
            onMove={(key, where) => onMove(c.id, key, where)}
          />
        ))}
      </ul>
    </SortableContext>
  );
}

function Row({
  card,
  status,
  estimateUnit,
  selected,
  onOpen,
  sections,
  currentKey,
  onMove,
}: {
  card: BacklogCard;
  status: StatusT | null;
  estimateUnit: EstimateUnit;
  selected: boolean;
  onOpen: () => void;
  sections: { key: string; name: string }[];
  currentKey: string;
  onMove: (key: string, where: "top" | "bottom") => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const key = card.cardKeyPrefix && card.keySeq != null ? `${card.cardKeyPrefix}-${card.keySeq}` : null;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-roledescription="draggable card"
      data-card-id={card.id}
      onClick={onOpen}
      className={cn(
        "flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm",
        selected ? "bg-accent/10" : "hover:bg-hover",
        isDragging ? "opacity-40" : "cursor-pointer active:cursor-grabbing",
      )}
    >
      <TypeIcon type={card.type} />
      {key && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{key}</span>}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          "min-w-0 flex-1 truncate rounded text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          card.done && "text-muted-foreground line-through",
        )}
      >
        {card.title}
      </button>
      <span className="hidden shrink-0 items-center gap-1 md:flex">
        {card.blocked && <BlockedTag />}
        {card.epic && <EpicTag title={card.epic.title} />}
        {card.labels.slice(0, 2).map((l) => (
          <LabelPill key={l.id} label={l} />
        ))}
      </span>
      {card.blocked && (
        <span className="shrink-0 md:hidden">
          <BlockedTag />
        </span>
      )}
      {status && (
        <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <StatusDot category={status.category} />
          {status.name}
        </span>
      )}
      {card.priority && <PriorityIcon priority={card.priority} />}
      {card.estimate != null && <EstimateChip estimate={card.estimate} unit={estimateUnit} />}
      <AvatarStack assignees={card.assignees} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Move ${card.title}`}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => onMove(currentKey, "top")}>Move to top</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onMove(currentKey, "bottom")}>Move to bottom</DropdownMenuItem>
          {sections.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Move to</DropdownMenuLabel>
              {sections
                .filter((s) => s.key !== currentKey)
                .map((s) => (
                  <DropdownMenuItem key={s.key} onSelect={() => onMove(s.key, s.key === BACKLOG ? "top" : "bottom")}>
                    {s.name}
                  </DropdownMenuItem>
                ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function EpicPanel({
  epics,
  value,
  onChange,
  hasNoEpic,
}: {
  epics: EpicT[];
  value: string;
  onChange: (v: string) => void;
  hasNoEpic: boolean;
}) {
  const item = (id: string, body: ReactNode) => (
    <li key={id || "all"}>
      <button
        type="button"
        aria-pressed={value === id}
        onClick={() => onChange(value === id ? "" : id)}
        className={cn("flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left text-sm", value === id ? "bg-accent/10 font-medium" : "hover:bg-hover")}
      >
        {body}
      </button>
    </li>
  );
  return (
    <aside aria-label="Epics" className="hidden w-64 shrink-0 rounded-lg border border-border bg-surface p-2 lg:sticky lg:top-4 lg:block">
      <h2 className="px-2 pb-1 text-xs font-semibold text-muted-foreground uppercase">Epics</h2>
      <ul className="flex max-h-[calc(100vh-12rem)] flex-col gap-0.5 overflow-y-auto">
        {item("", <span>All cards</span>)}
        {epics.map((e) =>
          item(
            e.id,
            <>
              <span className="flex min-w-0 items-center gap-1.5">
                <Zap className="size-3.5 shrink-0 text-epic-ink" aria-hidden="true" />
                {e.key && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{e.key}</span>}
                <span className="truncate">{e.title}</span>
              </span>
              {e.progress.total > 0 && (
                <span className="flex items-center gap-2 pl-5 text-[11px] text-muted-foreground">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <span className="block h-full bg-epic-ink" style={{ width: `${Math.round((e.progress.done / e.progress.total) * 100)}%` }} />
                  </span>
                  {e.progress.done}/{e.progress.total} done
                </span>
              )}
            </>,
          ),
        )}
        {hasNoEpic && item(NONE, <span className="text-muted-foreground">No epic</span>)}
      </ul>
      {epics.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No open epics. Make a card an epic to group work here.</p>}
    </aside>
  );
}
