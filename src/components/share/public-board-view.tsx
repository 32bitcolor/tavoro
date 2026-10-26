"use client";

import { useState } from "react";
import { ListChecks, Search } from "lucide-react";
import type { PublicBoard, PublicCard } from "@/lib/board-share";
import type { Block, Run } from "@/lib/rich-text";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DueChip, LabelPill, StatusDot } from "@/components/shared/work-item";
import { SAFE_HREF } from "@/lib/linkify";
import { cn } from "@/lib/utils";
import { LocalTime } from "@/components/shared/local-time";

// The read-only board a public link shows (lib/board-share.ts decides what's in it).
// Everything arrives as props; this page calls no server actions.

export function PublicBoardView({ board }: { board: PublicBoard }) {
  const [open, setOpen] = useState<PublicCard | null>(null);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const columns = board.columns.map((c) => ({
    ...c,
    cards: needle
      ? c.cards.filter((card) => `${card.key ?? ""} ${card.title} ${card.labels.map((l) => l.name).join(" ")}`.toLowerCase().includes(needle))
      : c.cards,
  }));
  const total = board.columns.reduce((n, c) => n + c.cards.length, 0);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-5 pb-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold break-words">{board.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {board.workspaceName} · {total} {total === 1 ? "card" : "cards"}
            {board.updatedAt && <> · updated <LocalTime iso={board.updatedAt} /></>}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter cards…" aria-label="Filter cards" className="h-8 pl-8" />
        </div>
      </header>

      {/* `relative` keeps the cards' sr-only text from stretching the page sideways. */}
      <div className="relative -mx-4 flex min-w-0 flex-1 items-start gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
        {columns.map((col) => (
          <section key={col.id} aria-label={col.name} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/60 p-2">
            <h2 className="flex items-center gap-2 px-1.5 pt-1 text-sm font-semibold">
              <StatusDot category={col.category} />
              <span className="truncate">{col.name}</span>
              <span className="ml-auto text-xs font-medium text-muted-foreground">{col.cards.length}</span>
            </h2>
            {col.cards.length === 0 && <p className="px-1.5 pb-2 text-xs text-muted-foreground">No cards</p>}
            {col.cards.map((card) => (
              <CardFace key={card.id} card={card} onOpen={() => setOpen(card)} />
            ))}
          </section>
        ))}
        {columns.length === 0 && <p className="text-sm text-muted-foreground">This board has no columns yet.</p>}
      </div>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              {open.key && <span className="font-mono text-xs font-medium text-muted-foreground">{open.key}</span>}
              <DialogTitle className="break-words">{open.title}</DialogTitle>
              <DialogDescription className="sr-only">Card details (read-only)</DialogDescription>
            </DialogHeader>
            <Meta card={open} />
            {open.description.length > 0 ? (
              <RichBlocks blocks={open.description} />
            ) : (
              <p className="text-sm text-muted-foreground">No description.</p>
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function CardFace({ card, onOpen }: { card: PublicCard; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-left text-sm shadow-xs outline-none hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {card.key && <span className="font-mono text-[11px] font-medium text-muted-foreground">{card.key}</span>}
      <span className="font-semibold leading-5 break-words whitespace-pre-wrap">{card.title}</span>
      <Meta card={card} />
    </button>
  );
}

function Meta({ card }: { card: PublicCard }) {
  const hasMeta = card.labels.length > 0 || card.dueDate || card.checklist.total > 0 || card.assignees.length > 0;
  if (!hasMeta) return null;
  return (
    <div className="flex flex-col gap-2">
      {card.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <LabelPill key={l.id} label={l} />
          ))}
        </div>
      )}
      {(card.dueDate || card.checklist.total > 0 || card.assignees.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs font-medium text-muted-foreground">
          {card.dueDate && <DueChip iso={card.dueDate} />}
          {card.checklist.total > 0 && (
            <span className={cn("inline-flex items-center gap-1", card.checklist.done === card.checklist.total && "text-success-ink")}>
              <ListChecks className="size-3.5" aria-hidden="true" />
              {card.checklist.done}/{card.checklist.total}
              <span className="sr-only"> subtasks done</span>
            </span>
          )}
          {card.assignees.length > 0 && <span className="truncate">{card.assignees.join(", ")}</span>}
        </div>
      )}
    </div>
  );
}

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => {
        if (r.br) return <br key={i} />;
        let node: React.ReactNode = r.text;
        if (r.code) node = <code className="rounded bg-muted px-1 font-mono text-[0.9em]">{node}</code>;
        if (r.bold) node = <strong>{node}</strong>;
        if (r.italic) node = <em>{node}</em>;
        if (r.underline) node = <u>{node}</u>;
        if (r.strike) node = <s>{node}</s>;
        if (r.href && SAFE_HREF.test(r.href))
          node = (
            <a href={r.href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2">
              {node}
            </a>
          );
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

function RichBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-2 text-sm leading-6 break-words">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h":
            return (
              <p key={i} className={cn("font-semibold", (b.level ?? 2) <= 2 ? "text-base" : "text-sm")}>
                <Runs runs={b.runs} />
              </p>
            );
          case "li":
            return (
              <div key={i} className="flex gap-2" style={{ paddingLeft: `${(b.level ?? 0) * 1.25}rem` }}>
                <span className="shrink-0 text-muted-foreground">{b.number != null ? `${b.number}.` : "•"}</span>
                <span className="min-w-0">
                  <Runs runs={b.runs} />
                </span>
              </div>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-border-strong pl-3 text-muted-foreground">
                <Runs runs={b.runs} />
              </blockquote>
            );
          case "code":
            return (
              <pre key={i} className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
                {b.runs.map((r) => r.text).join("")}
              </pre>
            );
          default:
            return b.runs.length ? (
              <p key={i}>
                <Runs runs={b.runs} />
              </p>
            ) : null;
        }
      })}
    </div>
  );
}
