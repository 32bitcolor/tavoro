"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Search, X, Zap } from "lucide-react";

import { addCardsToEpic, getEpicCards, listEpicOptions, searchEpicCandidates, setCardEpic } from "@/app/actions/epics";
import { TypeIcon } from "@/components/shared/card-fields";
import { AvatarStack } from "@/components/shared/work-item";
import { Select } from "@/components/ui/select";
import { asCardType } from "@/lib/card-fields";
import type { EpicRef } from "@/lib/epics";
import { cn } from "@/lib/utils";

// The two epic controls in the card drawer (docs/JIRA-PARITY.md): which epic a card is
// in, and — on an epic — the cards it holds.

export type EpicChip = { id: string; title: string };

/** Open a card: in the drawer when it's on this board, otherwise on its own board. */
function CardLink({
  id,
  boardId,
  currentBoardId,
  onNavigate,
  className,
  children,
}: {
  id: string;
  boardId: string;
  currentBoardId: string;
  onNavigate?: (cardId: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  if (boardId === currentBoardId && onNavigate) {
    return (
      <button type="button" onClick={() => onNavigate(id)} className={className}>
        {children}
      </button>
    );
  }
  return (
    <Link href={`/boards/${boardId}?card=${id}`} className={className}>
      {children}
    </Link>
  );
}

/** "Epic" in a card's details: the epic it's in, and a picker to change it. */
export function EpicField({
  cardId,
  boardId,
  epic: initial,
  onChange,
  onNavigate,
}: {
  cardId: string;
  boardId: string;
  epic: EpicRef | null;
  onChange: (epic: EpicChip | null) => void;
  onNavigate?: (cardId: string) => void;
}) {
  const [epic, setEpic] = useState<EpicRef | null>(initial);
  const [options, setOptions] = useState<{ id: string; title: string; key: string | null; boardId: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listEpicOptions().then((r) => live && setOptions(r.epics));
    return () => {
      live = false;
    };
  }, []);

  async function choose(id: string) {
    const next = id ? options?.find((o) => o.id === id) ?? null : null;
    const prev = epic;
    setEpic(next ? { id: next.id, title: next.title, key: next.key, boardId: next.boardId } : null);
    setError(null);
    const res = await setCardEpic(cardId, id || null);
    if ("error" in res) {
      setEpic(prev);
      setError(res.error ?? "Couldn’t change the epic.");
      return;
    }
    onChange(next ? { id: next.id, title: next.title } : null);
  }

  // The current epic may be done (and so not offered) — keep it selectable.
  const list = options ?? [];
  const withCurrent = epic && !list.some((o) => o.id === epic.id) ? [{ ...epic }, ...list] : list;

  return (
    <div className="flex flex-col gap-1.5">
      {epic && (
        <CardLink
          id={epic.id}
          boardId={epic.boardId}
          currentBoardId={boardId}
          onNavigate={onNavigate}
          className="inline-flex max-w-full items-center gap-1.5 self-start rounded-full bg-epic-ink/10 px-2 py-0.5 text-xs font-semibold text-epic-ink hover:underline"
        >
          <Zap className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{epic.title}</span>
          <span className="sr-only">(open epic)</span>
        </CardLink>
      )}
      <Select
        value={epic?.id ?? ""}
        onChange={(e) => choose(e.target.value)}
        disabled={options === null}
        className="h-8 w-full py-1 text-sm"
        aria-label="Epic"
      >
        <option value="">{options === null ? "Loading…" : "No epic"}</option>
        {withCurrent.map((o) => (
          <option key={o.id} value={o.id}>
            {o.key ? `${o.key} · ` : ""}
            {o.title}
          </option>
        ))}
      </Select>
      {options !== null && options.length === 0 && !epic && (
        <p className="text-xs text-muted-foreground">No epics yet. Make a card an epic by setting its type to Epic.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive-ink">
          {error}
        </p>
      )}
    </div>
  );
}

type Child = Awaited<ReturnType<typeof getEpicCards>> extends infer R ? (R extends { cards: (infer C)[] } ? C : never) : never;

/** On an epic: its cards, their progress, and adding or removing cards. */
export function EpicCardsSection({
  epicId,
  boardId,
  onNavigate,
  onProgress,
  onChildChange,
}: {
  epicId: string;
  boardId: string;
  onNavigate?: (cardId: string) => void;
  /** A card joined (true) or left (false) this epic, so its face on the board can follow. */
  onChildChange?: (cardId: string, inEpic: boolean) => void;
  /** Reports done/total so the board's card face can follow along. */
  onProgress?: (p: { done: number; total: number }) => void;
}) {
  const [cards, setCards] = useState<Child[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchEpicCandidates>>["cards"]>([]);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  });

  async function load() {
    const r = await getEpicCards(epicId);
    if ("error" in r) return;
    setCards(r.cards);
    setHidden(r.hidden);
    setProgress(r.progress);
    onProgressRef.current?.(r.progress);
  }

  useEffect(() => {
    let live = true;
    getEpicCards(epicId).then((r) => {
      if (!live || "error" in r) return;
      setCards(r.cards);
      setHidden(r.hidden);
      setProgress(r.progress);
      onProgressRef.current?.(r.progress);
    });
    return () => {
      live = false;
    };
  }, [epicId]);

  useEffect(() => {
    if (!adding) return;
    let live = true;
    const t = setTimeout(() => {
      searchEpicCandidates(epicId, query).then((r) => live && setResults(r.cards));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [adding, query, epicId]);

  async function add(id: string) {
    setError(null);
    const r = await addCardsToEpic(epicId, [id]);
    if (r.errors.length) setError(r.errors[0]);
    if (r.added.length) onChildChange?.(id, true);
    setResults((rs) => rs.filter((x) => x.id !== id));
    await load();
    searchRef.current?.focus();
  }

  async function remove(id: string) {
    setError(null);
    setCards((cs) => cs?.filter((c) => c.id !== id) ?? null);
    const r = await setCardEpic(id, null);
    if ("error" in r) setError(r.error ?? "Couldn’t remove it.");
    else onChildChange?.(id, false);
    await load();
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Epic progress"
          aria-valuemin={0}
          aria-valuemax={progress.total || 1}
          aria-valuenow={progress.done}
          aria-valuetext={`${progress.done} of ${progress.total} cards done`}
        >
          <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {progress.done} of {progress.total} done
        </span>
      </div>

      {cards === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : cards.length === 0 && hidden === 0 ? (
        <p className="text-sm text-muted-foreground">No cards in this epic yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {cards.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
              <TypeIcon type={asCardType(c.type)} />
              {c.key && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.key}</span>}
              <CardLink
                id={c.id}
                boardId={c.boardId}
                currentBoardId={boardId}
                onNavigate={onNavigate}
                className={cn("min-w-0 flex-1 truncate text-left hover:underline", c.done && "text-muted-foreground line-through")}
              >
                {c.title}
              </CardLink>
              {c.boardId !== boardId && <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:inline">{c.boardName}</span>}
              <span className="shrink-0 text-xs text-muted-foreground">{c.status ?? "No status"}</span>
              <AvatarStack assignees={c.assignees} />
              <button
                type="button"
                onClick={() => remove(c.id)}
                aria-label={`Remove ${c.title} from this epic`}
                title="Remove from epic"
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-hover hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
          {hidden > 0 && (
            <li className="px-2.5 py-1.5 text-xs text-muted-foreground">
              +{hidden} more on {hidden === 1 ? "a board" : "boards"} you can&rsquo;t see
            </li>
          )}
        </ul>
      )}

      {adding ? (
        <div className="flex flex-col gap-1.5">
          <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <span className="sr-only">Find a card to add</span>
            <input
              ref={searchRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setAdding(false);
                }
              }}
              placeholder="Search by title or key"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <ul className="flex max-h-56 flex-col overflow-y-auto rounded-md border border-border" aria-label="Cards you can add">
            {results.length === 0 && <li className="px-2.5 py-2 text-xs text-muted-foreground">No matching cards.</li>}
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => add(r.id)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-hover"
                >
                  <TypeIcon type={asCardType(r.type)} />
                  {r.key && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{r.key}</span>}
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  {r.currentEpic && <span className="shrink-0 truncate text-xs text-muted-foreground">moves from {r.currentEpic}</span>}
                  <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">Add to epic</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setAdding(false)} className="self-start text-xs font-medium text-muted-foreground hover:text-foreground">
            Done adding
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-8 items-center gap-1.5 self-start rounded-md px-2 text-sm text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add cards
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive-ink">
          {error}
        </p>
      )}
    </div>
  );
}
