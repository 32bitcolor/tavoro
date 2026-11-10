"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  ClipboardCheck,
  Clapperboard,
  Flag,
  GripVertical,
  Hand,
  ListChecks,
  MessageSquareText,
  Mic,
  MousePointerClick,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Wrench,
  Image as ImageIcon,
} from "lucide-react";

import { createScreen, deleteScreen, moveScreen, renameScreen, setScreenType, updateScreenField } from "@/app/actions/storyboards";
import { toggleScreenObjective } from "@/app/actions/objectives";
import { SCREEN_TYPES, SCREEN_TYPE_LABEL, type ScreenType } from "@/lib/storyboard";
import { plainText } from "@/lib/review-snapshot";
import { ConfirmDelete } from "@/components/shared/confirm-delete";
import { cn } from "@/lib/utils";
import { LessonEditor } from "@/components/storyboard/lesson-editor";

// The storyboard as "Rise Lite" (the Storyboards help topic): an outline of screens on
// the left, the selected screen as a lesson page in the middle (what learners see), and
// the team's notes beside it (narration, visuals, interaction, developer notes,
// objectives), which never reach learners. Same data as before: five fields per screen.

export type ProjectObjective = { id: string; text: string };

export type ScreenInit = {
  id: string;
  title: string;
  screenType: string;
  position: string;
  onScreenText: string | null;
  narration: string | null;
  visualNotes: string | null;
  interactionNotes: string | null;
  developerNotes: string | null;
  objectiveIds: string[];
};

export const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  intro: Flag,
  content: BookOpenText,
  video: Clapperboard,
  knowledge_check: ListChecks,
  interaction: MousePointerClick,
  assessment: ClipboardCheck,
  summary: CheckCircle2,
};

const NOTES = [
  { key: "narration", label: "Narration", hint: "What the voiceover says", icon: Mic },
  { key: "visualNotes", label: "Visuals", hint: "Images, media, layout", icon: ImageIcon },
  { key: "interactionNotes", label: "Interaction", hint: "What learners do, branching", icon: Hand },
  { key: "developerNotes", label: "Developer notes", hint: "Build and production notes", icon: Wrench },
] as const;
type NoteKey = (typeof NOTES)[number]["key"];

export function StoryboardStudio({
  storyboardId,
  initial,
  projectObjectives = [],
  onPreview,
  onChange,
  initialScreen,
}: {
  storyboardId: string;
  /** ?screen= from the address (read on the server, so hydration matches). */
  initialScreen?: string;
  initial: ScreenInit[];
  projectObjectives?: ProjectObjective[];
  onPreview: (screens: ScreenInit[], at?: string) => void;
  /** The screens as they are now (the page's Preview reads them). */
  onChange?: (screens: ScreenInit[]) => void;
}) {
  const [screens, setScreens] = useState<ScreenInit[]>(initial);
  const latest = useRef(screens);
  useEffect(() => {
    latest.current = screens;
    onChange?.(screens);
  }, [screens, onChange]);
  const [selected, setSelected] = useState<string | null>(() => (initialScreen && initial.some((x) => x.id === initialScreen) ? initialScreen : (initial[0]?.id ?? null)));
  const [, startTransition] = useTransition();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [focusTitle, setFocusTitle] = useState(false);

  const index = screens.findIndex((s) => s.id === selected);
  const screen = index >= 0 ? screens[index] : null;

  // Keep the selected screen in the address, so a reload or a shared link lands on it.
  useEffect(() => {
    const u = new URL(window.location.href);
    if (selected) u.searchParams.set("screen", selected);
    else u.searchParams.delete("screen");
    // null state: Next adopts the new address into its router (its own entries carry markers).
    window.history.replaceState(null, "", u);
  }, [selected]);

  useEffect(() => {
    if (focusTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
      setFocusTitle(false);
    }
  }, [focusTitle, selected]);

  const patch = (id: string, p: Partial<ScreenInit>) => setScreens((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));

  async function add(afterIndex: number) {
    const res = await createScreen(storyboardId, "Untitled screen");
    if (!("screen" in res) || !res.screen) return;
    const created = { ...res.screen, objectiveIds: [] as string[] };
    // New screens go to the end on the server; move it under the current one when that isn't the last.
    const at = afterIndex + 1;
    setScreens((prev) => {
      const next = [...prev, created];
      return at < prev.length ? arrayMove(next, next.length - 1, at) : next;
    });
    if (at < screens.length) startTransition(() => void moveScreen(created.id, at));
    setSelected(created.id);
    setFocusTitle(true);
  }

  function remove(id: string) {
    const i = screens.findIndex((s) => s.id === id);
    const next = screens.filter((s) => s.id !== id);
    setScreens(next);
    setSelected(next[Math.min(i, next.length - 1)]?.id ?? null);
    startTransition(() => void deleteScreen(id));
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = screens.findIndex((s) => s.id === e.active.id);
    const to = screens.findIndex((s) => s.id === e.over!.id);
    setScreens(arrayMove(screens, from, to));
    startTransition(() => void moveScreen(String(e.active.id), to));
  }

  return (
    <section aria-label="Screens" className="mt-6 grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)] min-[1400px]:grid-cols-[15rem_minmax(0,1fr)_19rem]">
      {/* Outline */}
      <nav aria-label="Outline" className="md:sticky md:top-16 md:max-h-[calc(100vh-5rem)] md:self-start md:overflow-y-auto">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outline</h2>
          <span className="text-xs text-muted-foreground">{screens.length} screen{screens.length === 1 ? "" : "s"}</span>
        </div>
        {/* Phones: a picker instead of the list. */}
        <div className="md:hidden">
          <label className="sr-only" htmlFor="screen-picker">Screen</label>
          <select id="screen-picker" value={selected ?? ""} onChange={(e) => setSelected(e.target.value)} className="h-10 w-full rounded-md border border-border bg-surface px-2 text-sm">
            {screens.map((s, i) => (
              <option key={s.id} value={s.id}>
                {i + 1}. {s.title}
              </option>
            ))}
          </select>
        </div>
        <DndContext id={`outline-${storyboardId}`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={screens.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ol className="hidden flex-col gap-0.5 md:flex">
              {screens.map((s, i) => (
                <OutlineItem key={s.id} screen={s} number={i + 1} active={s.id === selected} onSelect={() => setSelected(s.id)} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        <button
          type="button"
          onClick={() => add(screens.length - 1)}
          className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <Plus className="size-4" aria-hidden /> Add screen
        </button>
      </nav>

      {/* Lesson canvas */}
      {screen ? (
        <ScreenCanvas
          key={screen.id}
          screen={screen}
          number={index + 1}
          total={screens.length}
          titleRef={titleRef}
          onTitle={(title) => {
            patch(screen.id, { title });
            startTransition(() => void renameScreen(screen.id, title));
          }}
          onType={(t) => {
            patch(screen.id, { screenType: t });
            startTransition(() => void setScreenType(screen.id, t));
          }}
          onText={(json) => {
            patch(screen.id, { onScreenText: json });
            void updateScreenField(screen.id, "onScreenText", json);
          }}
          onPrev={index > 0 ? () => setSelected(screens[index - 1].id) : undefined}
          onNext={index < screens.length - 1 ? () => setSelected(screens[index + 1].id) : undefined}
          onAddAfter={() => add(index)}
          onRemove={() => remove(screen.id)}
          // After the click's blur has saved the text being edited.
          onPreview={() => setTimeout(() => onPreview(latest.current, screen.id), 0)}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
          <Sparkles className="size-6 text-accent" aria-hidden />
          <p className="text-sm text-muted-foreground">Start with the first screen: what should learners see first?</p>
          <button type="button" onClick={() => add(-1)} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground">
            <Plus className="size-4" aria-hidden /> Add the first screen
          </button>
        </div>
      )}

      {/* Team notes */}
      {screen && (
        <NotesPanel
          key={`notes-${screen.id}`}
          screen={screen}
          objectives={projectObjectives}
          onField={(k, json) => {
            patch(screen.id, { [k]: json });
            void updateScreenField(screen.id, k, json);
          }}
          onObjective={(oid, on) => {
            patch(screen.id, { objectiveIds: on ? [...screen.objectiveIds, oid] : screen.objectiveIds.filter((x) => x !== oid) });
            startTransition(() => void toggleScreenObjective(screen.id, oid, on));
          }}
        />
      )}
    </section>
  );
}

function OutlineItem({ screen, number, active, onSelect }: { screen: ScreenInit; number: number; active: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: screen.id });
  const Icon = TYPE_ICON[screen.screenType] ?? BookOpenText;
  const empty = !plainText(screen.onScreenText);
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("group relative", isDragging && "z-10 opacity-80")}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "step" : undefined}
        className={cn(
          "flex w-full items-start gap-2 rounded-md py-1.5 pl-2 pr-6 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          active ? "bg-accent/10 text-foreground" : "text-foreground/80 hover:bg-hover",
        )}
      >
        <span className={cn("w-5 shrink-0 pt-px text-right text-xs tabular-nums", active ? "text-accent" : "text-muted-foreground")}>{number}</span>
        <Icon className={cn("mt-0.5 size-3.5 shrink-0", active ? "text-accent" : "text-muted-foreground")} aria-hidden />
        <span className={cn("line-clamp-2 min-w-0 flex-1 leading-snug", active && "font-medium", empty && "text-muted-foreground")}>{screen.title}</span>
        <span className="sr-only">, {SCREEN_TYPE_LABEL[screen.screenType as ScreenType] ?? screen.screenType}</span>
      </button>
      <span
        {...attributes}
        {...listeners}
        aria-label={`Reorder screen ${number}`}
        className="absolute right-1 top-1.5 flex size-5 cursor-grab items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-hover group-hover:opacity-100 focus-visible:opacity-100"
      >
        <GripVertical className="size-3.5" aria-hidden />
      </span>
    </li>
  );
}

function ScreenCanvas({
  screen,
  number,
  total,
  titleRef,
  onTitle,
  onType,
  onText,
  onPrev,
  onNext,
  onAddAfter,
  onRemove,
  onPreview,
}: {
  screen: ScreenInit;
  number: number;
  total: number;
  titleRef: React.RefObject<HTMLTextAreaElement | null>;
  onTitle: (t: string) => void;
  onType: (t: string) => void;
  onText: (json: string | null) => void;
  onPrev?: () => void;
  onNext?: () => void;
  onAddAfter: () => void;
  onRemove: () => void;
  onPreview: () => void;
}) {
  const [title, setTitle] = useState(screen.title);
  const Icon = TYPE_ICON[screen.screenType] ?? BookOpenText;
  return (
    <article aria-label={`Screen ${number}: ${screen.title}`} className="min-w-0 rounded-xl border border-border bg-surface shadow-xs">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2 text-xs text-muted-foreground sm:px-10">
        <span>
          Screen {number} of {total}
        </span>
        <span aria-hidden>·</span>
        <label className="inline-flex items-center gap-1.5">
          <Icon className="size-3.5" aria-hidden />
          <span className="sr-only">Screen type</span>
          <select value={screen.screenType} onChange={(e) => onType(e.target.value)} className="w-auto rounded border-transparent bg-transparent py-0.5 pl-1 pr-6 text-xs text-foreground hover:bg-hover">
            {SCREEN_TYPES.map((t) => (
              <option key={t} value={t}>
                {SCREEN_TYPE_LABEL[t as ScreenType]}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onPreview} className="rounded px-2 py-1 font-medium text-foreground hover:bg-hover">
            Preview
          </button>
          <ConfirmDelete
            title="Delete this screen?"
            description="This permanently deletes the screen, its on-screen text and its notes."
            confirmLabel="Delete screen"
            onConfirm={onRemove}
            trigger={
              <button type="button" className="flex size-7 items-center justify-center rounded hover:bg-destructive/10 hover:text-destructive-ink" title="Delete screen" aria-label="Delete screen">
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            }
          />
        </span>
      </div>

      <div className="mx-auto max-w-[44rem] px-5 pb-10 pt-8 sm:px-10">
        <textarea
          ref={titleRef}
          value={title}
          rows={1}
          aria-label="Screen title"
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
          onBlur={() => title.trim() && title !== screen.title && onTitle(title.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
          className="field-sizing-content w-full resize-none bg-transparent text-3xl font-semibold leading-tight tracking-tight outline-none placeholder:text-muted-foreground"
          placeholder="Screen title"
        />
        <div className="mt-2 h-1 w-12 rounded-full bg-accent" aria-hidden />
        <div className="mt-6">
          <LessonEditor
            initial={screen.onScreenText}
            onSave={onText}
            label="On-screen text"
            placeholder="Write what learners see on this screen. Select text to format it. For a question, end a line with “?” and list the answers below it, with [x] before the right ones."
            className="min-h-48"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-5 py-3 sm:px-10">
        <button type="button" onClick={onPrev} disabled={!onPrev} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-hover hover:text-foreground disabled:invisible">
          <ArrowLeft className="size-4" aria-hidden /> Previous
        </button>
        <button type="button" onClick={onAddAfter} className="mx-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-hover hover:text-foreground">
          <Plus className="size-4" aria-hidden /> Screen after this
        </button>
        <button type="button" onClick={onNext} disabled={!onNext} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:invisible">
          Next <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </article>
  );
}

function NotesPanel({
  screen,
  objectives,
  onField,
  onObjective,
}: {
  screen: ScreenInit;
  objectives: ProjectObjective[];
  onField: (k: NoteKey, json: string | null) => void;
  onObjective: (id: string, on: boolean) => void;
}) {
  const filled = useMemo(() => new Set(NOTES.filter((n) => plainText(screen[n.key])).map((n) => n.key)), [screen]);
  const [open, setOpen] = useState<Set<NoteKey>>(() => new Set(NOTES.filter((n) => plainText(screen[n.key])).map((n) => n.key)));
  const shown = NOTES.filter((n) => open.has(n.key) || filled.has(n.key));
  const hidden = NOTES.filter((n) => !open.has(n.key) && !filled.has(n.key));

  return (
    <aside aria-label="Team notes" className="flex min-w-0 flex-col gap-4 md:col-start-2 min-[1400px]:col-start-auto min-[1400px]:sticky min-[1400px]:top-16 min-[1400px]:max-h-[calc(100vh-5rem)] min-[1400px]:self-start min-[1400px]:overflow-y-auto">
      <div>
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <MessageSquareText className="size-3.5" aria-hidden /> Team notes
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">For the people building and reviewing it. Learners never see these.</p>
      </div>

      {objectives.length > 0 && (
        <div>
          <h3 className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Target className="size-3.5" aria-hidden /> Teaches
          </h3>
          <ul className="flex flex-col gap-1">
            {objectives.map((o, i) => {
              const on = screen.objectiveIds.includes(o.id);
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onObjective(o.id, !on)}
                    className={cn("flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs", on ? "border-accent/40 bg-accent/10 text-foreground" : "border-transparent text-muted-foreground hover:bg-hover")}
                  >
                    <span className={cn("mt-px shrink-0 font-semibold", on && "text-accent")}>O{i + 1}</span>
                    <span className="min-w-0">{o.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {shown.map((n) => (
        <div key={n.key} className="rounded-lg bg-surface-muted/60 px-3 py-2.5">
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <n.icon className="size-3.5" aria-hidden /> {n.label}
          </h3>
          <LessonEditor initial={screen[n.key]} onSave={(json) => onField(n.key, json)} label={n.label} placeholder={n.hint} className="note-prose min-h-10" />
        </div>
      ))}

      {hidden.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {hidden.map((n) => (
            <button
              key={n.key}
              type="button"
              onClick={() => setOpen((prev) => new Set(prev).add(n.key))}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-xs text-muted-foreground hover:bg-hover hover:text-foreground"
            >
              <Plus className="size-3" aria-hidden /> {n.label}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
