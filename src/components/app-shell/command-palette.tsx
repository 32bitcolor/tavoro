"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Columns3,
  FolderKanban,
  Film,
  Shapes,
  LifeBuoy,
  Settings,
  RectangleHorizontal,
  ListChecks,
  Library,
  type LucideIcon,
} from "lucide-react";

import { MODULES } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type ResultType = "board" | "project" | "storyboard" | "whiteboard" | "content" | "card" | "subtask";
type SearchResult = { type: ResultType; id: string; label: string; href: string };
type Row = { key: string; label: string; href: string; icon: LucideIcon; sub?: string };

const TYPE_ICON: Record<ResultType, LucideIcon> = {
  board: Columns3,
  project: FolderKanban,
  storyboard: Film,
  whiteboard: Shapes,
  content: Library,
  card: RectangleHorizontal,
  subtask: ListChecks,
};
const TYPE_LABEL: Record<ResultType, string> = {
  board: "Board",
  project: "Project",
  storyboard: "Storyboard",
  whiteboard: "Whiteboard",
  content: "Content",
  card: "Card",
  subtask: "Subtask",
};

const GO_TO: Row[] = [
  ...MODULES.filter((m) => m.href).map((m) => ({ key: m.key, label: m.name, href: m.href!, icon: m.icon })),
  { key: "help", label: "Help & guides", href: "/help", icon: LifeBuoy },
  { key: "settings", label: "Settings", href: "/settings/account", icon: Settings },
];

function subscribeNever() {
  return () => {};
}
function isMacSnapshot() {
  return /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent);
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  // Browser-only read with no subscription — useSyncExternalStore avoids a
  // setState-in-effect just to learn the platform for a keyboard-hint label.
  const mac = React.useSyncExternalStore(subscribeNever, isMacSnapshot, () => false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function openPalette() {
    setQuery("");
    setResults([]);
    setActiveIndex(0);
    setOpen(true);
  }

  // Global ⌘K / Ctrl+K to open (or close), from anywhere in the app.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else openPalette();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Focus the input once the dialog has mounted — a DOM effect, not state.
  React.useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  function onQueryChange(value: string) {
    setQuery(value);
    setActiveIndex(0);
    if (value.trim().length < 2) {
      setResults([]);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  // Debounced content search once the query is meaningful. No state is touched
  // synchronously in the effect body — only inside the (async) timeout callback.
  React.useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        // aborted or network error — leave stale results alone
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  const filteredGoTo = query.trim()
    ? GO_TO.filter((r) => r.label.toLowerCase().includes(query.trim().toLowerCase()))
    : GO_TO;
  const searching = query.trim().length >= 2;
  const resultRows: Row[] = results.map((r) => ({
    key: `${r.type}-${r.id}`,
    label: r.label,
    href: r.href,
    icon: TYPE_ICON[r.type],
    sub: TYPE_LABEL[r.type],
  }));
  const rows: Row[] = [...filteredGoTo, ...(searching ? resultRows : [])];

  function go(row: Row | undefined) {
    if (!row) return;
    setOpen(false);
    router.push(row.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(rows[activeIndex]);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openPalette} className="text-muted-foreground hover:text-foreground">
        <Search className="size-4" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="ml-1 hidden rounded border border-border-strong bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:inline">
          {mac ? "⌘K" : "Ctrl K"}
        </kbd>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onKeyDown={onKeyDown}
          showCloseButton={false}
          className="top-[12vh] max-w-lg translate-y-0 gap-0 overflow-hidden rounded-xl bg-surface p-0 shadow-2xl"
        >
          <DialogTitle className="sr-only">Search Tavoro</DialogTitle>
          <DialogDescription className="sr-only">
            Jump to a module, or search boards, cards, subtasks, projects, storyboards, whiteboards, and content.
          </DialogDescription>

          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search or jump to…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            {filteredGoTo.length > 0 && (
              <RowGroup label="Go to" rows={filteredGoTo} rows0={rows} activeIndex={activeIndex} onHover={setActiveIndex} onSelect={go} />
            )}
            {searching && (
              <div className="mt-1">
                <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Results
                </p>
                {loading && resultRows.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">Searching…</p>
                ) : resultRows.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">No results for &ldquo;{query.trim()}&rdquo;.</p>
                ) : (
                  <RowGroup rows={resultRows} rows0={rows} activeIndex={activeIndex} onHover={setActiveIndex} onSelect={go} />
                )}
              </div>
            )}
            {filteredGoTo.length === 0 && !searching && (
              <p className="px-2 py-3 text-sm text-muted-foreground">Type to search…</p>
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><kbd className="rounded border border-border-strong bg-muted px-1">↑↓</kbd> navigate</span>
            <span className="flex items-center gap-1"><kbd className="rounded border border-border-strong bg-muted px-1">↵</kbd> select</span>
            <span className="flex items-center gap-1"><kbd className="rounded border border-border-strong bg-muted px-1">esc</kbd> close</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RowGroup({
  label,
  rows,
  rows0,
  activeIndex,
  onHover,
  onSelect,
}: {
  label?: string;
  rows: Row[];
  rows0: Row[];
  activeIndex: number;
  onHover: (i: number) => void;
  onSelect: (row: Row) => void;
}) {
  return (
    <div>
      {label && <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>}
      {rows.map((row) => {
        const globalIndex = rows0.indexOf(row);
        const active = globalIndex === activeIndex;
        return (
          <button
            key={row.key}
            onMouseEnter={() => onHover(globalIndex)}
            onClick={() => onSelect(row)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm",
              active ? "bg-accent/12 text-foreground" : "text-foreground/90 hover:bg-hover"
            )}
          >
            <row.icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-muted-foreground")} />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            {row.sub && <span className="shrink-0 text-xs text-muted-foreground">{row.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}
