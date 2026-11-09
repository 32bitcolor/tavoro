"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Link2, Plus, Search, X } from "lucide-react";

import { addCardLink, getCardLinks, removeCardLink, searchLinkCandidates } from "@/app/actions/card-links";
import { TypeIcon } from "@/components/shared/card-fields";
import { Select } from "@/components/ui/select";
import { asCardType } from "@/lib/card-fields";
import { LINK_CHOICES, type LinkChoice } from "@/lib/card-links";
import { cn } from "@/lib/utils";

// "Linked cards" in the card drawer (docs/JIRA-PARITY.md): blocks / is blocked by,
// relates to, duplicates, clones. Grouped by how they read from this card.

type LinkRow = Awaited<ReturnType<typeof getCardLinks>>["links"][number];
type Candidate = Awaited<ReturnType<typeof searchLinkCandidates>>["cards"][number];

export function CardLinksSection({
  cardId,
  boardId,
  onNavigate,
  onBlockedChange,
}: {
  cardId: string;
  boardId: string;
  onNavigate?: (cardId: string) => void;
  /** Whether this card is now blocked by an unfinished card, for its face on the board. */
  onBlockedChange?: (blocked: boolean) => void;
}) {
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState<LinkChoice>("relates");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  function apply(r: Awaited<ReturnType<typeof getCardLinks>>) {
    setLinks(r.links);
    setHidden(r.hidden);
    onBlockedChange?.(r.links.some((l) => l.label === "is blocked by" && !l.other.done));
  }

  useEffect(() => {
    let live = true;
    getCardLinks(cardId).then((r) => {
      if (!live) return;
      setLinks(r.links);
      setHidden(r.hidden);
    });
    return () => {
      live = false;
    };
  }, [cardId]);

  useEffect(() => {
    if (!adding) return;
    let live = true;
    const t = setTimeout(() => searchLinkCandidates(cardId, query).then((r) => live && setResults(r.cards)), 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [adding, query, cardId]);

  async function add(other: Candidate) {
    setError(null);
    const res = await addCardLink(cardId, other.id, choice);
    if ("error" in res) {
      setError(res.error ?? "Couldn’t link them.");
      return;
    }
    apply(await getCardLinks(cardId));
    setQuery("");
    setAdding(false);
  }

  async function remove(link: LinkRow) {
    setError(null);
    setLinks((ls) => ls?.filter((l) => l.id !== link.id) ?? null);
    const res = await removeCardLink(link.id);
    if ("error" in res) setError(res.error ?? "Couldn’t remove the link.");
    apply(await getCardLinks(cardId));
  }

  const groups = new Map<string, LinkRow[]>();
  for (const l of links ?? []) groups.set(l.label, [...(groups.get(l.label) ?? []), l]);

  return (
    <div className="flex flex-col gap-3">
      {links === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : links.length === 0 && hidden === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No linked cards.</p>
      ) : (
        [...groups.entries()].map(([label, rows]) => (
          <div key={label} className="flex flex-col gap-1">
            <h4 className="text-xs font-medium text-muted-foreground">
              {label[0].toUpperCase() + label.slice(1)}
            </h4>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {rows.map((l) => (
                <li key={l.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                  <TypeIcon type={asCardType(l.other.type)} />
                  {l.other.key && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{l.other.key}</span>}
                  {l.other.boardId === boardId && onNavigate ? (
                    <button
                      type="button"
                      onClick={() => onNavigate(l.other.id)}
                      className={cn("min-w-0 flex-1 truncate text-left hover:underline", l.other.done && "text-muted-foreground line-through")}
                    >
                      {l.other.title}
                    </button>
                  ) : (
                    <Link
                      href={`/boards/${l.other.boardId}?card=${l.other.id}`}
                      className={cn("min-w-0 flex-1 truncate hover:underline", l.other.done && "text-muted-foreground line-through")}
                    >
                      {l.other.title}
                    </Link>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">{l.other.status ?? ""}</span>
                  <button
                    type="button"
                    onClick={() => remove(l)}
                    aria-label={`Remove link: ${label} ${l.other.title}`}
                    title="Remove link"
                    className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-hover hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {hidden > 0 && (
        <p className="text-xs text-muted-foreground">
          +{hidden} linked {hidden === 1 ? "card" : "cards"} on boards you can&rsquo;t see
        </p>
      )}

      {adding ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={choice}
              onChange={(e) => setChoice(e.target.value as LinkChoice)}
              className="h-8 w-40 py-1 text-sm"
              aria-label="Link type"
            >
              {LINK_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            <label className="flex h-8 min-w-48 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
              <Search className="size-4 shrink-0" aria-hidden="true" />
              <span className="sr-only">Find a card to link</span>
              <input
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
          </div>
          <ul className="flex max-h-56 flex-col overflow-y-auto rounded-md border border-border" aria-label="Cards you can link">
            {results.length === 0 && <li className="px-2.5 py-2 text-xs text-muted-foreground">No matching cards.</li>}
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => add(r)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-hover">
                  <TypeIcon type={asCardType(r.type)} />
                  {r.key && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{r.key}</span>}
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">Link</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setAdding(false)} className="self-start text-xs font-medium text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-8 items-center gap-1.5 self-start rounded-md px-2 text-sm text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <Plus className="size-4" aria-hidden="true" />
          Link a card
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
