"use client";

import { createContext, useContext, useId, useState, useTransition, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Columns3,
  FileCheck2,
  Globe,
  Hash,
  List,
  ListChecks,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  createCard,
  deleteCard,
  createColumn,
  renameColumn,
  deleteColumn,
  moveColumn,
  moveCard,
  renameBoard,
  deleteBoard,
  setBoardCardKeyPrefix,
} from "@/app/actions/boards";
import Link from "next/link";
import { CardDrawer, type CardFacePatch } from "@/components/board/card-drawer";
import type { MoveResult } from "@/components/board/move-card-dialog";
import { ShareDialog } from "@/components/board/share-dialog";
import { ProjectContextStrip, type ProjectContext } from "@/components/board/project-context-strip";
import type { SavedViewDTO } from "@/app/actions/saved-views";
import type { BoardFilters } from "@/lib/saved-views";
import { FilterBar, type DueFilter } from "@/components/board/filter-bar";
import { useSetPageTitle } from "@/components/app-shell/breadcrumbs";
import { InlineTitle } from "@/components/shared/inline-title";
import { ConfirmDelete } from "@/components/shared/confirm-delete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { REVIEW_STATUS_LABEL, type ReviewStatus } from "@/lib/methodology";
import { AvatarStack, DueChip, LabelPill, StatusDot, type StatusCategory } from "@/components/shared/work-item";
import { cn } from "@/lib/utils";
import { EstimateChip, PriorityIcon, TypeIcon } from "@/components/shared/card-fields";
import { PRIORITY_LABEL, priorityRank, type CardType, type EstimateUnit, type Priority } from "@/lib/card-fields";

/** What card estimates count in this workspace, for every card face on the board. */
const EstimateUnitContext = createContext<EstimateUnit>("points");

type Label = { id: string; name: string; color: string };
type Member = { id: string; name: string | null; email: string };
type Card = {
  id: string;
  title: string;
  description: string | null;
  position: string;
  dueDate: string | null;
  keySeq: number | null;
  private: boolean;
  type: CardType;
  priority: Priority | null;
  estimate: number | null;
  labels: Label[];
  assignees: Member[];
  smes: Member[];
  checklist: { total: number; done: number };
  comments: number;
  attachments: number;
  deliverable: { name: string; review: { round: number; status: string } | null } | null;
};
type Column = { id: string; name: string; position: string; category: StatusCategory; cards: Card[] };
type ViewMode = "board" | "list";
type ListSort = "board" | "priority" | "estimate" | "due";

export function BoardView({
  boardId,
  boardName,
  cardKeyPrefix,
  publicShared,
  project,
  context,
  initialColumns,
  estimateUnit = "points",
}: {
  estimateUnit?: EstimateUnit;
  boardId: string;
  boardName: string;
  cardKeyPrefix: string | null;
  publicShared: boolean;
  project: { id: string; name: string } | null;
  context: ProjectContext | null;
  initialColumns: Column[];
}) {
  const [columns, setColumns] = useState<Column[]>(initialColumns);
  // A stable id for dnd-kit's accessibility ids, so the server and client render match.
  const dndId = useId();
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Seeds from ?card=<id> so links from elsewhere (e.g. My Work's subtasks
  // section) land straight on the right card's drawer, not just the board.
  // The stack lets a subtask's drawer open "on top of" its parent's: opening
  // a top-level card resets the stack, opening/returning to a subtask id
  // pushes/pops it — nesting is capped at one level so the stack never grows
  // past 2 entries in practice.
  const [cardStack, setCardStack] = useState<string[]>(() => {
    const c = searchParams.get("card");
    return c ? [c] : [];
  });
  const openCardId = cardStack.length > 0 ? cardStack[cardStack.length - 1] : null;
  const [, startTransition] = useTransition();
  // Board vs. list is kept in the URL so a reload or a shared link keeps the view.
  const [view, setView] = useState<ViewMode>(() => (searchParams.get("view") === "list" ? "list" : "board"));
  // Which column's composer the header's "New card" button opened.
  const [composeIn, setComposeIn] = useState<string | null>(null);

  function changeView(next: ViewMode) {
    setView(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "list") params.set("view", "list");
    else params.delete("view");
    params.delete("card");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function openCard(cardId: string) {
    setCardStack([cardId]);
  }

  function navigateCard(cardId: string) {
    setCardStack((prev) => {
      const idx = prev.indexOf(cardId);
      // already in the stack (e.g. the subtask's "back to parent" link) -> pop back to it
      if (idx >= 0) return prev.slice(0, idx + 1);
      return [...prev, cardId];
    });
  }

  function closeDrawer() {
    setCardStack([]);
    if (searchParams.get("card")) router.replace(pathname, { scroll: false });
  }

  // ── Filters: a client-side view over the already-loaded cards ──
  const [fLabels, setFLabels] = useState<Set<string>>(new Set());
  const [fAssignees, setFAssignees] = useState<Set<string>>(new Set());
  const [fDue, setFDue] = useState<DueFilter>("any");
  const [fTypes, setFTypes] = useState<Set<string>>(new Set());
  const [fPriorities, setFPriorities] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  // Which saved view (if any) produced the filters currently applied. Cleared the
  // moment the user hand-edits a filter, so the menu never claims a view is active
  // while showing something else.
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const availableLabels = useMemo(() => {
    const map = new Map<string, Label>();
    columns.forEach((c) => c.cards.forEach((card) => card.labels.forEach((l) => map.set(l.id, l))));
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [columns]);

  const availableMembers = useMemo(() => {
    const map = new Map<string, Member>();
    columns.forEach((c) => c.cards.forEach((card) => card.assignees.forEach((a) => map.set(a.id, a))));
    return [...map.values()].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  }, [columns]);

  const filtersActive =
    fLabels.size > 0 || fAssignees.size > 0 || fTypes.size > 0 || fPriorities.size > 0 || fDue !== "any" || search.trim() !== "";

  const filteredColumns = useMemo(() => {
    if (!filtersActive) return columns;
    const today = new Date().toISOString().slice(0, 10);
    const weekEnd = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString().slice(0, 10);
    })();
    const q = search.trim().toLowerCase();
    const match = (card: Card) => {
      if (fLabels.size > 0 && !card.labels.some((l) => fLabels.has(l.id))) return false;
      if (fAssignees.size > 0 && !card.assignees.some((a) => fAssignees.has(a.id))) return false;
      if (fTypes.size > 0 && !fTypes.has(card.type)) return false;
      if (fPriorities.size > 0 && !fPriorities.has(card.priority ?? "none")) return false;
      if (fDue !== "any") {
        const ymd = card.dueDate ? card.dueDate.slice(0, 10) : null;
        if (fDue === "none" && ymd) return false;
        if (fDue === "overdue" && !(ymd && ymd < today)) return false;
        if (fDue === "week" && !(ymd && ymd >= today && ymd <= weekEnd)) return false;
      }
      if (q && !card.title.toLowerCase().includes(q)) return false;
      return true;
    };
    return columns.map((c) => ({ ...c, cards: c.cards.filter(match) }));
  }, [columns, fLabels, fAssignees, fTypes, fPriorities, fDue, search, filtersActive]);

  const totalCount = useMemo(() => columns.reduce((n, c) => n + c.cards.length, 0), [columns]);
  const visibleCount = useMemo(
    () => filteredColumns.reduce((n, c) => n + c.cards.length, 0),
    [filteredColumns],
  );
  // The visible cards in reading order — what the panel's previous/next steps through.
  const navIds = useMemo(() => filteredColumns.flatMap((c) => c.cards.map((card) => card.id)), [filteredColumns]);

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setFLabels(new Set());
    setFAssignees(new Set());
    setFTypes(new Set());
    setFPriorities(new Set());
    setFDue("any");
    setSearch("");
    setActiveViewId(null);
  }

  function currentFilters() {
    return {
      labels: [...fLabels],
      assignees: [...fAssignees],
      types: [...fTypes],
      priorities: [...fPriorities],
      due: fDue,
      search,
    };
  }

  function applyView(view: SavedViewDTO | null) {
    if (!view) {
      clearFilters();
      return;
    }
    const f = view.filters as BoardFilters;
    setFLabels(new Set(f.labels));
    setFAssignees(new Set(f.assignees));
    setFTypes(new Set(f.types ?? []));
    setFPriorities(new Set(f.priorities ?? []));
    setFDue(f.due);
    setSearch(f.search);
    setActiveViewId(view.id);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const colOfCard = (cardId: string, cols: Column[]) =>
    cols.find((c) => c.cards.some((card) => card.id === cardId));

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActiveCard(colOfCard(id, columns)?.cards.find((c) => c.id === id) ?? null);
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    setColumns((prev) => {
      const from = colOfCard(activeId, prev);
      if (!from) return prev;
      const to = prev.find((c) => c.id === overId) ?? colOfCard(overId, prev);
      if (!to || to.id === from.id) return prev;

      const card = from.cards.find((c) => c.id === activeId)!;
      const overCardIndex = to.cards.findIndex((c) => c.id === overId);
      const insertAt = overCardIndex >= 0 ? overCardIndex : to.cards.length;

      return prev.map((c) => {
        if (c.id === from.id) return { ...c, cards: c.cards.filter((x) => x.id !== activeId) };
        if (c.id === to.id)
          return { ...c, cards: [...c.cards.slice(0, insertAt), card, ...c.cards.slice(insertAt)] };
        return c;
      });
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveCard(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    let working = columns;
    const activeCol = colOfCard(activeId, working);
    if (!activeCol) return;
    const overCol = working.find((c) => c.id === overId) ?? colOfCard(overId, working);
    if (!overCol) return;

    if (activeCol.id === overCol.id) {
      const oldIndex = activeCol.cards.findIndex((c) => c.id === activeId);
      const newIndex = activeCol.cards.findIndex((c) => c.id === overId);
      if (newIndex >= 0 && oldIndex !== newIndex) {
        const reordered = arrayMove(activeCol.cards, oldIndex, newIndex);
        working = working.map((c) => (c.id === activeCol.id ? { ...c, cards: reordered } : c));
        setColumns(working);
      }
    }

    const finalCol = colOfCard(activeId, working)!;
    const finalIndex = finalCol.cards.findIndex((c) => c.id === activeId);
    startTransition(() => void moveCard(activeId, finalCol.id, finalIndex));
  }

  // ── Mutations (optimistic local state + persisted server action) ──

  async function handleAddCard(columnId: string, title: string) {
    const res = await createCard(columnId, title);
    if ("card" in res && res.card) {
      const card: Card = {
        id: res.card.id,
        title: res.card.title,
        description: res.card.description,
        position: res.card.position,
        dueDate: null,
        keySeq: res.card.keySeq,
        private: false,
        type: "task",
        priority: null,
        estimate: null,
        labels: [],
        assignees: [],
        smes: [],
        checklist: { total: 0, done: 0 },
        comments: 0,
        attachments: 0,
        deliverable: null,
      };
      setColumns((prev) => prev.map((c) => (c.id === columnId ? { ...c, cards: [...c.cards, card] } : c)));
    }
  }

  // After "Move to board…": the card leaves this board; a notice links to where it went.
  const [moved, setMoved] = useState<{ cardId: string; title: string; result: MoveResult } | null>(null);
  function handleMoved(cardId: string, result: MoveResult) {
    const title = columns.flatMap((c) => c.cards).find((c) => c.id === cardId)?.title ?? "Card";
    setColumns((prev) => prev.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== cardId) })));
    closeDrawer();
    setMoved({ cardId, title, result });
  }

  async function handleDeleteCard(cardId: string) {
    // Await so a rejected delete surfaces in the confirm dialog instead of
    // optimistically vanishing and silently reverting on reload.
    const res = await deleteCard(cardId);
    if (res?.error) return res;
    setColumns((prev) => prev.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== cardId) })));
  }

  /** Move a card to the end of another column — the non-drag path (WCAG 2.5.7)
   *  behind the panel's Status picker. */
  function handleMoveToColumn(cardId: string, toColumnId: string) {
    const from = colOfCard(cardId, columns);
    const to = columns.find((c) => c.id === toColumnId);
    if (!from || !to || from.id === to.id) return;
    const card = from.cards.find((c) => c.id === cardId)!;
    setColumns((prev) =>
      prev.map((c) => {
        if (c.id === from.id) return { ...c, cards: c.cards.filter((x) => x.id !== cardId) };
        if (c.id === to.id) return { ...c, cards: [...c.cards, card] };
        return c;
      }),
    );
    startTransition(() => void moveCard(cardId, to.id, to.cards.length));
  }

  function patchCard(cardId: string, patch: CardFacePatch) {
    setColumns((prev) =>
      prev.map((col) => ({
        ...col,
        cards: col.cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
      })),
    );
  }

  async function handleAddColumn(name: string) {
    const res = await createColumn(boardId, name);
    if ("column" in res && res.column) {
      setColumns((prev) => [...prev, { ...res.column, category: null, cards: [] }]);
    }
  }

  function handleRenameColumn(columnId: string, name: string) {
    setColumns((prev) => prev.map((c) => (c.id === columnId ? { ...c, name } : c)));
    startTransition(() => void renameColumn(columnId, name));
  }

  function handleDeleteColumn(columnId: string) {
    setColumns((prev) => prev.filter((c) => c.id !== columnId));
    startTransition(() => void deleteColumn(columnId));
  }

  function handleMoveColumn(columnId: string, dir: -1 | 1) {
    const index = columns.findIndex((c) => c.id === columnId);
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= columns.length) return;
    setColumns(arrayMove(columns, index, newIndex));
    startTransition(() => void moveColumn(columnId, newIndex));
  }

  function startNewCard() {
    const first = columns[0];
    if (!first) return;
    if (view === "list") changeView("board");
    setComposeIn(first.id);
  }

  // Which column the open card sits in (top-level cards only; a subtask has none).
  const openCardColumn = openCardId ? colOfCard(openCardId, columns) ?? null : null;
  const navIndex = openCardId ? navIds.indexOf(openCardId) : -1;

  return (
    <EstimateUnitContext value={estimateUnit}>
    <div className="flex h-full min-h-screen min-w-0 flex-col gap-4 px-6 pt-5 pb-10">
      <BoardHeader
        boardId={boardId}
        boardName={boardName}
        cardKeyPrefix={cardKeyPrefix}
        publicShared={publicShared}
        project={project}
        view={view}
        onView={changeView}
        onNewCard={startNewCard}
        canAddCard={columns.length > 0}
      />

      {context && <ProjectContextStrip context={context} />}

      {moved && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm shadow-xs">
          <ArrowRightLeft className="size-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            Moved <strong className="font-semibold">{moved.title}</strong> to {moved.result.boardName}
            {moved.result.key && <> as <span className="font-mono text-xs">{moved.result.key}</span></>}
            {moved.result.leftSprint && <>. It left its sprint, since that board doesn&rsquo;t plan in sprints</>}.
          </span>
          <Link href={`/boards/${moved.result.boardId}?card=${moved.cardId}`} className="font-medium text-accent underline underline-offset-2 hover:no-underline">
            Open it
          </Link>
          <button type="button" onClick={() => setMoved(null)} aria-label="Dismiss" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      )}

      <FilterBar
        labels={availableLabels}
        members={availableMembers}
        selectedLabels={fLabels}
        onToggleLabel={(id) => { setActiveViewId(null); toggleSet(setFLabels, id); }}
        selectedAssignees={fAssignees}
        onToggleAssignee={(id) => { setActiveViewId(null); toggleSet(setFAssignees, id); }}
        selectedTypes={fTypes}
        onToggleType={(t) => { setActiveViewId(null); toggleSet(setFTypes, t); }}
        selectedPriorities={fPriorities}
        onTogglePriority={(p) => { setActiveViewId(null); toggleSet(setFPriorities, p); }}
        due={fDue}
        onDue={(d) => { setActiveViewId(null); setFDue(d); }}
        search={search}
        onSearch={(s) => { setActiveViewId(null); setSearch(s); }}
        active={filtersActive}
        onClear={clearFilters}
        visible={visibleCount}
        total={totalCount}
        boardId={boardId}
        currentFilters={currentFilters}
        activeViewId={activeViewId}
        onApplyView={applyView}
      />

      {view === "list" ? (
        <ListView columns={filteredColumns} cardKeyPrefix={cardKeyPrefix} openCardId={openCardId} onOpen={openCard} />
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          {/* `relative` makes this scroller the containing block for the cards' sr-only
              (absolutely positioned) text — otherwise those resolve against <main>
              and stretch the whole page sideways on narrow screens. */}
          <div className="relative -mx-6 flex min-w-0 flex-1 items-start gap-3 overflow-x-auto px-6 pb-2">
            {filteredColumns.map((col, i) => (
              <ColumnView
                key={col.id}
                column={col}
                cardKeyPrefix={cardKeyPrefix}
                canMoveLeft={i > 0}
                canMoveRight={i < filteredColumns.length - 1}
                // Drag stays enabled while filtered — the drag handlers operate on
                // the full card state, so a drop lands at the visible neighbor's
                // real position among the hidden cards.
                dragDisabled={false}
                composing={composeIn === col.id}
                onComposeDone={() => setComposeIn(null)}
                openCardId={openCardId}
                onAddCard={handleAddCard}
                onDeleteCard={handleDeleteCard}
                onOpenCard={openCard}
                onRename={handleRenameColumn}
                onDelete={handleDeleteColumn}
                onMove={handleMoveColumn}
              />
            ))}
            <AddColumn onAdd={handleAddColumn} />
          </div>

          <DragOverlay>{activeCard ? <CardShell card={activeCard} cardKeyPrefix={cardKeyPrefix} dragging /> : null}</DragOverlay>
        </DndContext>
      )}

      {openCardId && (
        <CardDrawer
          cardId={openCardId}
          onClose={closeDrawer}
          onPatch={patchCard}
          onDeleted={handleDeleteCard}
          onMoved={handleMoved}
          onNavigate={navigateCard}
          columns={columns.map((c) => ({ id: c.id, name: c.name }))}
          currentColumnId={openCardColumn?.id ?? null}
          onMoveToColumn={(columnId) => handleMoveToColumn(openCardId, columnId)}
          position={navIndex >= 0 ? { index: navIndex, total: navIds.length } : null}
          onStep={(dir) => {
            const next = navIds[navIndex + dir];
            if (next) openCard(next);
          }}
        />
      )}
    </div>
    </EstimateUnitContext>
  );
}

function BoardHeader({
  boardId,
  boardName,
  cardKeyPrefix,
  publicShared,
  project,
  view,
  onView,
  onNewCard,
  canAddCard,
}: {
  boardId: string;
  boardName: string;
  cardKeyPrefix: string | null;
  publicShared: boolean;
  project: { id: string; name: string } | null;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  onNewCard: () => void;
  canAddCard: boolean;
}) {
  const [name, setName] = useState(boardName);
  const [prefixOpen, setPrefixOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shared, setShared] = useState(publicShared);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [, startTransition] = useTransition();
  // A project's board reads "Projects / <project> / <board>" in the header crumbs,
  // replacing the separate "‹ project" back-link the page used to carry.
  useSetPageTitle(
    name,
    project
      ? [
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${project.id}` },
        ]
      : null,
  );

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-[12rem] flex-1">
        <InlineTitle
          value={name}
          onChange={setName}
          onCommit={() => {
            if (name.trim() && name !== boardName) startTransition(() => void renameBoard(boardId, name));
          }}
          ariaLabel="Board name"
          className="text-2xl"
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {shared && (
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-accent/10 px-2.5 text-xs font-semibold text-accent outline-none hover:bg-accent/15 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Globe className="size-3.5" aria-hidden="true" />
            Public link on
          </button>
        )}
        <div role="group" aria-label="View" className="flex rounded-md bg-muted p-0.5">
          <ViewToggle active={view === "board"} onClick={() => onView("board")} icon={<Columns3 className="size-4" />}>
            Board
          </ViewToggle>
          <ViewToggle active={view === "list"} onClick={() => onView("list")} icon={<List className="size-4" />}>
            List
          </ViewToggle>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Board settings">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => setPrefixOpen(true)}>
              <Hash className="size-4" />
              Card prefix{cardKeyPrefix ? ` · ${cardKeyPrefix}` : "…"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShareOpen(true)}>
              <Globe className="size-4" />
              {shared ? "Public link…" : "Share publicly…"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2 className="size-4" />
              Delete board…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" onClick={onNewCard} disabled={!canAddCard}>
          <Plus className="size-4" />
          New card
        </Button>
      </div>

      <PrefixDialog boardId={boardId} current={cardKeyPrefix} open={prefixOpen} onOpenChange={setPrefixOpen} />
      <ShareDialog boardId={boardId} open={shareOpen} onOpenChange={setShareOpen} onShared={setShared} />
      <ConfirmDelete
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this board?"
        description="This permanently deletes the board and all of its columns and cards."
        confirmLabel="Delete board"
        onConfirm={() => deleteBoard(boardId)}
      />
    </header>
  );
}

function ViewToggle({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span aria-hidden="true">{icon}</span>
      {children}
    </button>
  );
}

/** Card-key prefix editing, moved off the page header into its own small dialog. */
function PrefixDialog({
  boardId,
  current,
  open,
  onOpenChange,
}: {
  boardId: string;
  current: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    const next = value.trim().toUpperCase();
    if (next === (current ?? "")) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      const res = await setBoardCardKeyPrefix(boardId, next);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (o) {
          setValue(current ?? "");
          setError(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Card prefix</DialogTitle>
          <DialogDescription>Cards on this board get short keys like WP-12 that you can link to.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="card-key-prefix" className="text-sm font-medium">Prefix</label>
          <Input
            id="card-key-prefix"
            value={value}
            onChange={(e) => {
              setValue(e.target.value.toUpperCase());
              setError(null);
            }}
            placeholder="e.g. WP"
            maxLength={8}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "card-key-prefix-error" : undefined}
            className="w-32 font-medium tracking-wide"
          />
          {error && <p id="card-key-prefix-error" role="alert" className="text-sm text-destructive-ink">{error}</p>}
          <DialogFooter className="mt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ColumnView({
  column,
  cardKeyPrefix,
  canMoveLeft,
  canMoveRight,
  dragDisabled,
  composing,
  onComposeDone,
  openCardId,
  onAddCard,
  onDeleteCard,
  onOpenCard,
  onRename,
  onDelete,
  onMove,
}: {
  column: Column;
  cardKeyPrefix: string | null;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  dragDisabled: boolean;
  composing: boolean;
  onComposeDone: () => void;
  openCardId: string | null;
  onAddCard: (columnId: string, title: string) => void;
  onDeleteCard: (cardId: string) => unknown;
  onOpenCard: (cardId: string) => void;
  onRename: (columnId: string, name: string) => void;
  onDelete: (columnId: string) => void;
  onMove: (columnId: string, dir: -1 | 1) => void;
}) {
  const { setNodeRef } = useDroppable({ id: column.id, data: { type: "column" } });
  const [name, setName] = useState(column.name);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <section
      aria-label={column.name}
      className="flex min-w-[12.5rem] max-w-[22rem] flex-1 shrink-0 flex-col rounded-lg bg-surface-muted"
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <StatusDot category={column.category} />
        <InlineTitle
          value={name}
          onChange={setName}
          onCommit={() => name.trim() && name !== column.name && onRename(column.id, name.trim())}
          ariaLabel="Column name"
          className="text-sm font-semibold tracking-normal"
        />
        <span className="shrink-0 text-xs font-medium text-muted-foreground">{column.cards.length}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" className="size-6 text-muted-foreground" aria-label={`${column.name} column options`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={!canMoveLeft} onSelect={() => onMove(column.id, -1)}>
              <ArrowLeft className="size-4" />
              Move left
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveRight} onSelect={() => onMove(column.id, 1)}>
              <ArrowRight className="size-4" />
              Move right
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2 className="size-4" />
              Delete column…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ConfirmDelete
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete this column?"
          description="This permanently deletes the column and all of its cards."
          confirmLabel="Delete column"
          onConfirm={() => onDelete(column.id)}
        />
      </div>

      <div ref={setNodeRef} className="flex flex-col gap-2 p-2">
        <SortableContext items={column.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {column.cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              cardKeyPrefix={cardKeyPrefix}
              disabled={dragDisabled}
              selected={card.id === openCardId}
              onDelete={onDeleteCard}
              onOpen={onOpenCard}
            />
          ))}
        </SortableContext>
        <CardComposer forceOpen={composing} onClose={onComposeDone} onAdd={(title) => onAddCard(column.id, title)} />
      </div>
    </section>
  );
}

function SortableCard({
  card,
  cardKeyPrefix,
  disabled,
  selected,
  onDelete,
  onOpen,
}: {
  card: Card;
  cardKeyPrefix: string | null;
  disabled: boolean;
  selected: boolean;
  onDelete: (id: string) => unknown;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card" },
    disabled,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} aria-roledescription="draggable card">
      <CardShell
        card={card}
        cardKeyPrefix={cardKeyPrefix}
        selected={selected}
        onDelete={() => onDelete(card.id)}
        onOpen={() => onOpen(card.id)}
      />
    </div>
  );
}

function reviewLabel(review: { round: number; status: string }) {
  const status = REVIEW_STATUS_LABEL[review.status as ReviewStatus] ?? review.status;
  return `Round ${review.round} · ${status.toLowerCase()}`;
}

function CardShell({
  card,
  cardKeyPrefix,
  selected,
  onDelete,
  onOpen,
  dragging,
}: {
  card: Card;
  cardKeyPrefix: string | null;
  selected?: boolean;
  onDelete?: () => unknown;
  onOpen?: () => void;
  dragging?: boolean;
}) {
  const estimateUnit = useContext(EstimateUnitContext);
  const key = cardKeyPrefix && card.keySeq != null ? `${cardKeyPrefix}-${card.keySeq}` : null;
  const hasPeople = card.assignees.length > 0 || card.smes.length > 0;
  const hasMeta =
    card.dueDate || card.estimate != null || card.checklist.total > 0 || card.comments > 0 || card.attachments > 0 || hasPeople;

  return (
    <div
      onClick={onOpen}
      className={cn(
        "group relative flex flex-col gap-2 rounded-lg border bg-surface p-3 text-sm shadow-xs transition-shadow",
        selected ? "border-accent ring-1 ring-accent" : "border-border hover:shadow-sm",
        dragging ? "rotate-1 shadow-md" : "cursor-pointer active:cursor-grabbing",
      )}
    >
      <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <TypeIcon type={card.type} />
            {key && <span className="font-mono text-[11px] font-medium text-muted-foreground">{key}</span>}
            {card.priority && <PriorityIcon priority={card.priority} />}
            {card.private && <PrivateTag />}
          </span>
          {onDelete && (
            <ConfirmDelete
              onConfirm={onDelete}
              title="Delete this card?"
              description="This permanently deletes the card and its subtasks, comments, and attachments."
              confirmLabel="Delete card"
              trigger={
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  className="-my-1 -mr-1 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive-ink focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Delete card ${card.title}`}
                >
                  <X className="size-4" />
                </button>
              }
            />
          )}
        </div>

      {/* The title is the card's keyboard-reachable "open" control — Enter on the
          outer draggable starts a keyboard drag instead. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="-m-0.5 rounded p-0.5 text-left font-semibold leading-5 break-words whitespace-pre-wrap text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {card.title}
      </button>

      {card.deliverable && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <FileCheck2 className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate">
            {card.deliverable.name}
            {card.deliverable.review && <> · {reviewLabel(card.deliverable.review)}</>}
          </span>
        </span>
      )}

      {card.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <LabelPill key={l.id} label={l} />
          ))}
        </div>
      )}

      {hasMeta && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs font-medium text-muted-foreground">
          {card.estimate != null && <EstimateChip estimate={card.estimate} unit={estimateUnit} />}
          {card.dueDate && <DueChip iso={card.dueDate} />}
          {card.checklist.total > 0 && (
            <span
              className={cn("inline-flex items-center gap-1", card.checklist.done === card.checklist.total && "text-success-ink")}
              title="Subtasks done"
            >
              <ListChecks className="size-3.5" aria-hidden="true" />
              {card.checklist.done}/{card.checklist.total}
              <span className="sr-only"> subtasks done</span>
            </span>
          )}
          {card.comments > 0 && (
            <span className="inline-flex items-center gap-1" title="Comments">
              <MessageSquare className="size-3.5" aria-hidden="true" />
              {card.comments}
              <span className="sr-only"> comments</span>
            </span>
          )}
          {card.attachments > 0 && (
            <span className="inline-flex items-center gap-1" title="Attachments">
              <Paperclip className="size-3.5" aria-hidden="true" />
              {card.attachments}
              <span className="sr-only"> attachments</span>
            </span>
          )}
          {hasPeople && (
            <span className="ml-auto">
              <AvatarStack assignees={card.assignees} smes={card.smes} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** List view: every visible card as a row, grouped by column. */
function ListView({
  columns,
  cardKeyPrefix,
  openCardId,
  onOpen,
}: {
  columns: Column[];
  cardKeyPrefix: string | null;
  openCardId: string | null;
  onOpen: (id: string) => void;
}) {
  const estimateUnit = useContext(EstimateUnitContext);
  const span = cardKeyPrefix ? 7 : 6;
  // Sorting reorders the rows within each column group; "board" keeps the board's order.
  const [sort, setSort] = useState<ListSort>("board");
  const sorted = useMemo(() => {
    if (sort === "board") return columns;
    const cmp = (a: Card, b: Card) => {
      if (sort === "priority") return priorityRank(a.priority) - priorityRank(b.priority);
      if (sort === "estimate") return (b.estimate ?? -1) - (a.estimate ?? -1);
      const ad = a.dueDate ?? "9999";
      const bd = b.dueDate ?? "9999";
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    };
    return columns.map((c) => ({ ...c, cards: [...c.cards].sort(cmp) }));
  }, [columns, sort]);
  const sortHeader = (key: Exclude<ListSort, "board">, label: string, className: string) => (
    <th scope="col" className={cn("px-4 py-2 font-medium", className)} aria-sort={sort === key ? (key === "estimate" ? "descending" : "ascending") : undefined}>
      <button
        type="button"
        onClick={() => setSort(sort === key ? "board" : key)}
        className="-mx-1 rounded px-1 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        title={sort === key ? "Back to board order" : `Sort by ${label.toLowerCase()}`}
      >
        {label}
        {sort === key && <span aria-hidden="true"> {key === "estimate" ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[52rem] table-fixed border-collapse text-sm">
        <caption className="sr-only">Cards grouped by column</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
            {cardKeyPrefix && <th scope="col" className="w-28 px-4 py-2 font-medium">Key</th>}
            <th scope="col" className="px-4 py-2 font-medium">Title</th>
            {sortHeader("priority", "Priority", "w-24")}
            {sortHeader("estimate", estimateUnit === "hours" ? "Hours" : "Points", "w-20")}
            <th scope="col" className="w-72 px-4 py-2 font-medium">Labels</th>
            {sortHeader("due", "Due", "w-28")}
            <th scope="col" className="w-28 px-4 py-2 font-medium">People</th>
          </tr>
        </thead>
        {sorted.map((col) => (
          <tbody key={col.id}>
            <tr className="bg-surface-muted">
              <th scope="rowgroup" colSpan={span} className="px-4 py-1.5 text-left text-xs font-semibold">
                <span className="inline-flex items-center gap-2">
                  <StatusDot category={col.category} />
                  {col.name}
                  <span className="font-medium text-muted-foreground">{col.cards.length}</span>
                </span>
              </th>
            </tr>
            {col.cards.length === 0 && (
              <tr>
                <td colSpan={span} className="px-4 py-2 text-xs text-muted-foreground">No cards</td>
              </tr>
            )}
            {col.cards.map((card) => {
              const selected = card.id === openCardId;
              return (
                <tr
                  key={card.id}
                  onClick={() => onOpen(card.id)}
                  className={cn(
                    "cursor-pointer border-t border-border hover:bg-hover",
                    selected && "bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]",
                  )}
                >
                  {cardKeyPrefix && (
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {card.keySeq != null ? `${cardKeyPrefix}-${card.keySeq}` : ""}
                    </td>
                  )}
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(card.id);
                      }}
                      className="flex w-full items-center gap-1.5 rounded text-left font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <TypeIcon type={card.type} />
                      <span className="truncate">{card.title}</span>
                    </button>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {card.priority && (
                      <span className="inline-flex items-center gap-1">
                        <PriorityIcon priority={card.priority} />
                        <span aria-hidden="true">{PRIORITY_LABEL[card.priority]}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs tabular-nums">{card.estimate ?? ""}</td>
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap gap-1 overflow-hidden">
                      {card.private && <PrivateTag />}
                      {card.labels.map((l) => (
                        <LabelPill key={l.id} label={l} />
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs font-medium">
                    {card.dueDate && <DueChip iso={card.dueDate} />}
                  </td>
                  <td className="px-4 py-2">
                    <AvatarStack assignees={card.assignees} smes={card.smes} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function CardComposer({
  onAdd,
  forceOpen,
  onClose,
}: {
  onAdd: (title: string) => void;
  forceOpen?: boolean;
  onClose?: () => void;
}) {
  const [value, setValue] = useState("");
  const [opened, setOpened] = useState(false);
  const open = opened || !!forceOpen;

  function close() {
    setValue("");
    setOpened(false);
    onClose?.();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpened(true)}
        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        <Plus className="size-4" aria-hidden="true" />
        Add card
      </button>
    );
  }

  function submit() {
    const title = value.trim();
    if (title) onAdd(title);
    close();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        autoFocus
        aria-label="New card title"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") close();
        }}
        rows={2}
        placeholder="Card title…"
        className="min-h-0 resize-none bg-surface"
      />
      <div className="flex gap-2">
        <Button size="xs" onClick={submit}>Add</Button>
        <Button size="xs" variant="ghost" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

function AddColumn({ onAdd }: { onAdd: (name: string) => void }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add a column"
        title="Add a column"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
    );
  }

  function submit() {
    const name = value.trim();
    if (name) onAdd(name);
    setValue("");
    setOpen(false);
  }

  return (
    <div className="flex w-60 shrink-0 flex-col gap-1.5 rounded-lg border border-border p-3">
      <Input
        autoFocus
        aria-label="Column name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") { setValue(""); setOpen(false); }
        }}
        placeholder="Column name…"
        className="bg-surface"
      />
      <div className="flex gap-2">
        <Button size="xs" onClick={submit}>Add column</Button>
        <Button size="xs" variant="ghost" onClick={() => { setValue(""); setOpen(false); }}>Cancel</Button>
      </div>
    </div>
  );
}

/** Private cards are left off the board's public link. */
function PrivateTag() {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
      <Lock className="size-3" aria-hidden="true" />
      Private
    </span>
  );
}
