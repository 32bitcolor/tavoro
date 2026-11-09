"use client";

import { useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, HelpCircle, Loader2, Search, X } from "lucide-react";

import { bulkUpdateCards, searchCards, type BulkChange } from "@/app/actions/card-query";
import { setCardStatus } from "@/app/actions/boards";
import { useSetPageTitle } from "@/components/app-shell/breadcrumbs";
import { CardDrawer } from "@/components/board/card-drawer";
import { PriorityIcon, TypeIcon } from "@/components/shared/card-fields";
import { PageHeader } from "@/components/shared/page";
import { SavedViewsMenu } from "@/components/shared/saved-views-menu";
import { AvatarStack, LabelPill, StatusDot, type StatusCategory } from "@/components/shared/work-item";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { SavedViewDTO } from "@/app/actions/saved-views";
import { formatEstimate, type EstimateUnit } from "@/lib/card-fields";
import { DEFAULT_QUERY, FIELDS, PRIORITY_ORDER, TYPES } from "@/lib/query/compile";
import type { QueryResult, QueryRow } from "@/lib/query/run";
import { suggest } from "@/lib/query/suggest";
import type { QueryFilters } from "@/lib/saved-views";
import { cn } from "@/lib/utils";

// The Cards page (docs/JIRA-PARITY.md, phase 7): every card you can see, found with a
// query, in a table you can sort, choose columns for, save, and change in bulk.

type Data = {
  projects: { id: string; name: string }[];
  statuses: { id: string; name: string; category: string }[];
  labels: { id: string; name: string }[];
  members: { id: string; name: string | null; email: string }[];
  sprints: { id: string; name: string; status: string }[];
  boards: { id: string; name: string; prefix: string | null }[];
  epics: { id: string; title: string; key: string | null }[];
};

const COLUMNS = [
  { key: "type", label: "Type", sort: "type" },
  { key: "status", label: "Status", sort: "status" },
  { key: "priority", label: "Priority", sort: "priority" },
  { key: "assignee", label: "Assignee" },
  { key: "estimate", label: "Estimate", sort: "estimate" },
  { key: "sprint", label: "Sprint" },
  { key: "epic", label: "Epic" },
  { key: "labels", label: "Labels" },
  { key: "due", label: "Due", sort: "due" },
  { key: "start", label: "Start", sort: "start" },
  { key: "board", label: "Board" },
  { key: "project", label: "Project" },
  { key: "created", label: "Created", sort: "created" },
  { key: "updated", label: "Updated", sort: "updated" },
] as const;
type ColKey = (typeof COLUMNS)[number]["key"];
const DEFAULT_COLUMNS: ColKey[] = ["type", "status", "priority", "assignee", "sprint", "updated"];
const PAGE = 50;

const fmtDay = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Replace (or add) the ORDER BY clause, to sort by a column header. */
function withOrder(q: string, field: string, desc: boolean) {
  const base = q.replace(/\s*\border\s+by\b[\s\S]*$/i, "").trim();
  return `${base}${base ? " " : ""}ORDER BY ${field}${desc ? " DESC" : ""}`;
}
function currentOrder(q: string): { field: string; desc: boolean } | null {
  const m = /\border\s+by\s+([a-z]+)(\s+desc)?/i.exec(q);
  return m ? { field: m[1].toLowerCase(), desc: !!m[2] } : null;
}

export function CardsView({
  initialQuery,
  initialPage,
  initialResult,
  data,
  estimateUnit,
}: {
  initialQuery: string;
  initialPage: number;
  initialResult: QueryResult;
  data: Data;
  estimateUnit: EstimateUnit;
}) {
  useSetPageTitle("Cards");
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);
  const [ran, setRan] = useState(initialQuery);
  const [page, setPage] = useState(initialPage);
  const [result, setResult] = useState<QueryResult>(initialResult);
  const [busy, setBusy] = useState(false);
  // The text a failed query had, so its error can point into it while it's unchanged.
  const [failedText, setFailedText] = useState(initialResult.ok ? "" : initialQuery);
  const [columns, setColumns] = useState<ColKey[]>(DEFAULT_COLUMNS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string; details?: string[] } | null>(null);

  async function run(q = query, p = 0) {
    setBusy(true);
    const r = await searchCards(q, p);
    setBusy(false);
    setResult(r);
    if (!r.ok) setFailedText(q);
    if (r.ok) {
      setRan(q);
      setPage(p);
      // Keep only selections still in the result.
      setSelected((s) => new Set([...s].filter((id) => r.ids.includes(id))));
      const params = new URLSearchParams({ q });
      if (p) params.set("page", String(p));
      router.replace(`${pathname}?${params}`, { scroll: false });
    }
  }

  const ok = result.ok ? result : null;
  const rows = ok?.rows ?? [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const order = currentOrder(ran);

  function sortBy(field: string) {
    const desc = order?.field === field ? !order.desc : field === "updated" || field === "created" || field === "priority";
    const q = withOrder(ran, field, desc);
    setQuery(q);
    run(q, 0);
  }

  return (
    <div className="flex min-h-screen min-w-0 flex-col gap-4 px-4 pt-5 pb-24 sm:px-6">
      <PageHeader title="Cards" description="Find any card across every board with a query, then sort, save, or change them in bulk." />

      <QueryBar
        value={query}
        onChange={(v) => {
          setQuery(v);
          setActiveViewId(null);
        }}
        onRun={() => run(query, 0)}
        busy={busy}
        error={result.ok ? null : result}
        failedText={failedText}
        data={data}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {ok ? `${ok.total.toLocaleString()} ${ok.total === 1 ? "card" : "cards"}${ok.truncated ? " (the first 5,000)" : ""}` : "Fix the query to see cards"}
        </span>
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 className="size-3.5" aria-hidden="true" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Show columns</DropdownMenuLabel>
            {COLUMNS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={columns.includes(c.key)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(on) => setColumns((cs) => (on ? COLUMNS.map((x) => x.key).filter((k) => k === c.key || cs.includes(k)) : cs.filter((k) => k !== c.key)))}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <SavedViewsMenu
          scope="query"
          currentFilters={(): QueryFilters => ({ q: ran, columns })}
          filtersActive={ran.trim() !== "" && ran.trim() !== DEFAULT_QUERY}
          activeViewId={activeViewId}
          onApply={(view: SavedViewDTO | null) => {
            if (!view) {
              setActiveViewId(null);
              setQuery(DEFAULT_QUERY);
              setColumns(DEFAULT_COLUMNS);
              run(DEFAULT_QUERY, 0);
              return;
            }
            const f = view.filters as QueryFilters;
            setActiveViewId(view.id);
            setQuery(f.q);
            if (f.columns.length) setColumns(f.columns.filter((c): c is ColKey => COLUMNS.some((x) => x.key === c)));
            run(f.q, 0);
          }}
        />
      </div>

      {notice && (
        <div role={notice.tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", notice.tone === "error" ? "border-destructive/30 bg-destructive/5 text-destructive-ink" : "border-border bg-surface-muted")}>
          <div className="flex-1">
            <p>{notice.text}</p>
            {notice.details && (
              <ul className="mt-1 list-disc pl-5 text-xs">
                {notice.details.slice(0, 20).map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {ok && ok.total > 0 && allOnPage && ok.total > rows.length && selected.size < Math.min(ok.total, 1000) && (
        <p className="rounded-md bg-surface-muted px-3 py-1.5 text-sm">
          All {rows.length} on this page are selected.{" "}
          <button type="button" className="font-medium text-accent underline underline-offset-2" onClick={() => setSelected(new Set(ok.ids.slice(0, 1000)))}>
            Select all {Math.min(ok.total, 1000).toLocaleString()} matching{ok.total > 1000 ? " (the first 1,000)" : ""}
          </button>
        </p>
      )}

      <div className="relative overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface-muted text-xs text-muted-foreground">
            <tr>
              <th className="w-9 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allOnPage}
                  onChange={(e) => setSelected((s) => {
                    const n = new Set(s);
                    rows.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id)));
                    return n;
                  })}
                  className="size-4 accent-[var(--accent)]"
                />
              </th>
              <SortHeader label="Key" field="key" order={order} onSort={sortBy} />
              <SortHeader label="Title" field="title" order={order} onSort={sortBy} />
              {COLUMNS.filter((c) => columns.includes(c.key)).map((c) =>
                "sort" in c ? <SortHeader key={c.key} label={c.label} field={c.sort} order={order} onSort={sortBy} /> : (
                  <th key={c.key} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                    {c.label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <Row key={r.id} row={r} columns={columns} unit={estimateUnit} selected={selected.has(r.id)} onSelect={(on) => setSelected((s) => {
                const n = new Set(s);
                if (on) n.add(r.id);
                else n.delete(r.id);
                return n;
              })} onOpen={() => setOpenId(r.id)} />
            ))}
            {ok && rows.length === 0 && (
              <tr>
                <td colSpan={3 + columns.length} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No cards match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {busy && (
          <div className="absolute inset-0 flex items-start justify-center bg-surface/50 pt-10">
            <Loader2 className="size-5 animate-spin text-accent" aria-label="Loading" />
          </div>
        )}
      </div>

      {ok && ok.total > PAGE && (
        <nav aria-label="Pages" className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span>
            {(page * PAGE + 1).toLocaleString()}–{Math.min(ok.total, (page + 1) * PAGE).toLocaleString()} of {ok.total.toLocaleString()}
          </span>
          <Button variant="outline" size="icon-sm" disabled={page === 0 || busy} onClick={() => run(ran, page - 1)} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={(page + 1) * PAGE >= ok.total || busy} onClick={() => run(ran, page + 1)} aria-label="Next page">
            <ChevronRight className="size-4" />
          </Button>
        </nav>
      )}

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          data={data}
          onClear={() => setSelected(new Set())}
          onApply={async (change, label) => {
            const res = await bulkUpdateCards([...selected], change);
            if ("error" in res && res.error) {
              setNotice({ tone: "error", text: res.error });
              return;
            }
            const r = res as { updated: number; failed: { card: string; error: string }[] };
            setNotice({
              tone: r.failed.length ? "error" : "ok",
              text: `${label}: ${r.updated} ${r.updated === 1 ? "card" : "cards"} updated${r.failed.length ? `, ${r.failed.length} not` : ""}.`,
              details: r.failed.map((f) => `${f.card}: ${f.error}`),
            });
            if (change.kind === "delete") setSelected(new Set());
            await run(ran, page);
          }}
        />
      )}

      {openId && (
        <CardDrawer
          cardId={openId}
          onClose={() => {
            setOpenId(null);
            run(ran, page);
          }}
          onPatch={() => {}}
          onDeleted={() => {
            setOpenId(null);
            run(ran, page);
          }}
          onNavigate={(id) => setOpenId(id)}
          columns={data.statuses.map((s) => ({ id: s.id, name: s.name }))}
          onMoveToColumn={(statusId) => openId && setCardStatus(openId, statusId)}
          position={(() => {
            const i = rows.findIndex((r) => r.id === openId);
            return i >= 0 ? { index: i, total: rows.length } : null;
          })()}
          onStep={(dir) => {
            const i = rows.findIndex((r) => r.id === openId);
            const next = rows[i + dir];
            if (next) setOpenId(next.id);
          }}
        />
      )}
    </div>
  );
}

function SortHeader({ label, field, order, onSort }: { label: string; field: string; order: { field: string; desc: boolean } | null; onSort: (f: string) => void }) {
  const active = order?.field === field;
  return (
    <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap" aria-sort={active ? (order!.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {active && (order!.desc ? <ArrowDown className="size-3" aria-hidden="true" /> : <ArrowUp className="size-3" aria-hidden="true" />)}
      </button>
    </th>
  );
}

function Row({ row: r, columns, unit, selected, onSelect, onOpen }: { row: QueryRow; columns: ColKey[]; unit: EstimateUnit; selected: boolean; onSelect: (on: boolean) => void; onOpen: () => void }) {
  const cell = (k: ColKey) => {
    switch (k) {
      case "type":
        return <TypeIcon type={r.type} />;
      case "status":
        return r.status ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <StatusDot category={r.status.category as StatusCategory} />
            {r.status.name}
          </span>
        ) : null;
      case "priority":
        return r.priority ? (
          <span className="inline-flex items-center gap-1 capitalize">
            <PriorityIcon priority={r.priority} />
            {r.priority}
          </span>
        ) : null;
      case "assignee":
        return <AvatarStack assignees={r.assignees} />;
      case "estimate":
        return r.estimate != null ? <span className="tabular-nums">{formatEstimate(r.estimate, unit)}</span> : null;
      case "sprint":
        return r.sprint?.name ?? null;
      case "epic":
        return r.epic ? <span className="whitespace-nowrap">{r.epic.key ?? r.epic.title}</span> : null;
      case "labels":
        return (
          <span className="flex flex-wrap gap-1">
            {r.labels.map((l) => (
              <LabelPill key={l.id} label={l} />
            ))}
          </span>
        );
      case "due":
        return r.due ? fmtDay(r.due) : null;
      case "start":
        return r.start ? fmtDay(r.start) : null;
      case "board":
        return r.board.name;
      case "project":
        return r.project?.name ?? null;
      case "created":
        return fmtDay(r.created);
      case "updated":
        return fmtDay(r.updated);
    }
  };
  return (
    <tr className={cn("hover:bg-hover", selected && "bg-accent/5")}>
      <td className="px-3 py-1.5">
        <input type="checkbox" aria-label={`Select ${r.key ?? r.title}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} className="size-4 accent-[var(--accent)]" />
      </td>
      <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap text-muted-foreground">{r.key}</td>
      <td className="max-w-[28rem] px-3 py-1.5">
        <button type="button" onClick={onOpen} className={cn("block max-w-full truncate text-left hover:underline", r.status?.category === "done" && "text-muted-foreground line-through")}>
          {r.title}
        </button>
      </td>
      {columns.map((k) => (
        <td key={k} className={cn("px-3 py-1.5 text-muted-foreground", k !== "labels" && "whitespace-nowrap")}>
          {cell(k)}
        </td>
      ))}
    </tr>
  );
}

// ── Query bar ──

function QueryBar({
  value,
  onChange,
  onRun,
  busy,
  error,
  failedText,
  data,
}: {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  busy: boolean;
  error: { error: string; pos: number; end: number } | null;
  failedText: string;
  data: Data;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(value.length);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const sug = useMemo(() => suggest(value, caret, data), [value, caret, data]);
  const show = open && sug.items.length > 0;

  function apply(i: number) {
    const s = sug.items[i];
    if (!s) return;
    const next = value.slice(0, sug.from) + s.insert + (s.insert.endsWith("(") ? "" : " ") + value.slice(sug.to).replace(/^\s+/, "");
    const pos = sug.from + s.insert.length + (s.insert.endsWith("(") ? 0 : 1);
    onChange(next);
    setCaret(pos);
    setActive(0);
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(pos, pos);
      input.current?.focus();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={`${id}-q`} className="sr-only">
            Query
          </label>
          <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-3 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={input}
              id={`${id}-q`}
              role="combobox"
              aria-expanded={show}
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={show ? `${id}-opt-${active}` : undefined}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-err` : `${id}-help`}
              value={value}
              spellCheck={false}
              autoComplete="off"
              placeholder='status = "In progress" AND assignee = me ORDER BY priority DESC'
              onChange={(e) => {
                onChange(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
                setOpen(true);
                setActive(0);
              }}
              onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 120)}
              onKeyDown={(e) => {
                if (show && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                  e.preventDefault();
                  setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + sug.items.length) % sug.items.length);
                } else if (show && e.key === "Tab") {
                  e.preventDefault();
                  apply(active);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (show && e.altKey === false && sug.items.length && value.slice(sug.from, sug.to).length > 0) apply(active);
                  else {
                    setOpen(false);
                    onRun();
                  }
                } else if (e.key === "Escape") setOpen(false);
              }}
              className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground"
            />
          </div>
          {show && (
            <ul id={`${id}-list`} role="listbox" aria-label="Suggestions" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm shadow-lg">
              {sug.items.map((s, i) => (
                <li
                  key={`${s.label}-${i}`}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    apply(i);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex cursor-pointer items-center gap-3 rounded px-2 py-1", i === active && "bg-hover")}
                >
                  <span className="font-mono text-xs">{s.label}</span>
                  {s.hint && <span className="truncate text-xs text-muted-foreground">{s.hint}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button onClick={onRun} disabled={busy} className="h-10">
          Search
        </Button>
      </div>
      {error ? (
        <div id={`${id}-err`} role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
          <p className="font-mono text-xs break-all whitespace-pre-wrap">
            {failedText === value ? (
              <>
                {value.slice(0, error.pos)}
                <mark className="rounded-sm bg-destructive/20 text-destructive-ink">{value.slice(error.pos, Math.max(error.end, error.pos + 1)) || " "}</mark>
                {value.slice(Math.max(error.end, error.pos + 1))}
              </>
            ) : (
              value
            )}
          </p>
          <p className="mt-1 text-destructive-ink">{error.error}</p>
        </div>
      ) : (
        <details id={`${id}-help`} className="text-xs text-muted-foreground">
          <summary className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground">
            <HelpCircle className="size-3.5" aria-hidden="true" />
            How to write a query
          </summary>
          <div className="mt-2 grid gap-x-6 gap-y-1 rounded-md border border-border p-3 sm:grid-cols-2">
            <p className="sm:col-span-2">
              Combine conditions with <code>AND</code>, <code>OR</code>, <code>NOT</code> and brackets; sort with <code>ORDER BY field [DESC]</code>. Operators:{" "}
              <code>= != &gt; &gt;= &lt; &lt;= ~ (contains) in (…) not in (…) is EMPTY</code>. Put values with spaces in quotes.
            </p>
            {FIELDS.map((f) => (
              <p key={f.name}>
                <code className="text-foreground">{f.name}</code> — {f.hint}
              </p>
            ))}
            <p className="sm:col-span-2">
              Examples: <code>assignee = me AND done = false</code> · <code>labels in (qa, video) AND priority &gt;= high</code> · <code>due &lt; 7d AND sprint = active</code> · <code>epic is EMPTY AND type = story</code>
            </p>
          </div>
        </details>
      )}
    </div>
  );
}

// ── Bulk edit ──

type Pending = { change: BulkChange; label: string; destructive?: boolean };

function BulkBar({ count, data, onClear, onApply }: { count: number; data: Data; onClear: () => void; onApply: (c: BulkChange, label: string) => Promise<void> }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [field, setField] = useState("");
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState("");
  const person = (id: string) => {
    const m = data.members.find((x) => x.id === id);
    return m?.name ?? m?.email ?? "someone";
  };

  function choose(kind: string, value: string) {
    setField("");
    switch (kind) {
      case "status":
        return setPending({ change: { kind: "status", statusId: value }, label: `Set status to ${data.statuses.find((s) => s.id === value)?.name}` });
      case "assign":
        return setPending({ change: { kind: "assignee", userId: value, add: true }, label: `Assign ${person(value)}` });
      case "unassign":
        return setPending({ change: { kind: "assignee", userId: value, add: false }, label: `Unassign ${person(value)}` });
      case "priority":
        return setPending({ change: { kind: "priority", priority: value === "none" ? null : value }, label: value === "none" ? "Clear priority" : `Set priority to ${value}` });
      case "type":
        return setPending({ change: { kind: "type", type: value }, label: `Make them ${value === "epic" ? "epics" : `${value}s`}` });
      case "sprint":
        return setPending({ change: { kind: "sprint", sprintId: value === "none" ? null : value }, label: value === "none" ? "Take them out of their sprint" : `Move to ${data.sprints.find((s) => s.id === value)?.name}` });
      case "epic":
        return setPending({ change: { kind: "epic", epicId: value === "none" ? null : value }, label: value === "none" ? "Take them out of their epic" : `Add to ${data.epics.find((e) => e.id === value)?.key ?? "epic"}` });
      case "addLabel":
        return setPending({ change: { kind: "label", labelId: value, add: true }, label: `Add label ${data.labels.find((l) => l.id === value)?.name}` });
      case "removeLabel":
        return setPending({ change: { kind: "label", labelId: value, add: false }, label: `Remove label ${data.labels.find((l) => l.id === value)?.name}` });
      case "watch":
        return setPending({ change: { kind: "watch", on: value === "on" }, label: value === "on" ? "Watch them" : "Stop watching them" });
      case "board":
        return setPending({ change: { kind: "board", boardId: value }, label: `Move to the board ${data.boards.find((b) => b.id === value)?.name}` });
      case "delete":
        return setPending({ change: { kind: "delete" }, label: "Delete", destructive: true });
    }
  }

  const options: Record<string, { value: string; label: string }[]> = {
    status: data.statuses.map((s) => ({ value: s.id, label: s.name })),
    assign: data.members.map((m) => ({ value: m.id, label: m.name ?? m.email })),
    unassign: data.members.map((m) => ({ value: m.id, label: m.name ?? m.email })),
    priority: [...PRIORITY_ORDER.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) })), { value: "none", label: "None" }],
    type: TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })),
    sprint: [...data.sprints.filter((s) => s.status !== "completed").map((s) => ({ value: s.id, label: s.name })), { value: "none", label: "No sprint" }],
    epic: [...data.epics.map((e) => ({ value: e.id, label: `${e.key ? `${e.key} ` : ""}${e.title}` })), { value: "none", label: "No epic" }],
    addLabel: data.labels.map((l) => ({ value: l.id, label: l.name })),
    removeLabel: data.labels.map((l) => ({ value: l.id, label: l.name })),
    watch: [{ value: "on", label: "Watch" }, { value: "off", label: "Stop watching" }],
    board: data.boards.map((b) => ({ value: b.id, label: b.name })),
  };
  const FIELD_LABEL: Record<string, string> = {
    status: "Status",
    assign: "Assign",
    unassign: "Unassign",
    priority: "Priority",
    type: "Type",
    estimate: "Estimate",
    sprint: "Sprint",
    epic: "Epic",
    addLabel: "Add label",
    removeLabel: "Remove label",
    watch: "Watch",
    board: "Move to board",
    delete: "Delete",
  };

  return (
    <>
      <div role="region" aria-label="Bulk edit" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur sm:left-auto sm:right-6 sm:bottom-6 sm:rounded-lg sm:border">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{count.toLocaleString()} selected</span>
          <Select aria-label="Change" value={field} onChange={(e) => (e.target.value === "delete" ? choose("delete", "") : setField(e.target.value))} className="h-8 w-40 py-1 text-sm">
            <option value="">Change…</option>
            {Object.entries(FIELD_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          {field === "estimate" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const n = estimate.trim() === "" ? null : Number(estimate);
                if (n != null && (!Number.isFinite(n) || n < 0)) return;
                setField("");
                setPending({ change: { kind: "estimate", estimate: n }, label: n == null ? "Clear the estimate" : `Set the estimate to ${n}` });
              }}
              className="flex items-center gap-1"
            >
              <Input aria-label="Estimate" value={estimate} onChange={(e) => setEstimate(e.target.value)} inputMode="decimal" placeholder="blank clears" className="h-8 w-28" />
              <Button type="submit" size="sm">
                Set
              </Button>
            </form>
          ) : field && options[field] ? (
            <Select aria-label={FIELD_LABEL[field]} value="" onChange={(e) => e.target.value && choose(field, e.target.value)} className="h-8 w-52 py-1 text-sm">
              <option value="">{FIELD_LABEL[field]}…</option>
              {options[field].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear selection
          </Button>
        </div>
      </div>
      <Dialog open={!!pending} onOpenChange={(v) => !v && !busy && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pending?.label} — {count.toLocaleString()} {count === 1 ? "card" : "cards"}?
            </DialogTitle>
            <DialogDescription>
              {pending?.destructive
                ? "This deletes the cards with their subtasks, comments and attachments. It can’t be undone."
                : "Each card’s History records the change. People get one email about it, not one per card."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={pending?.destructive ? "destructive" : "default"}
              disabled={busy}
              onClick={async () => {
                if (!pending) return;
                setBusy(true);
                await onApply(pending.change, pending.label);
                setBusy(false);
                setPending(null);
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {pending?.destructive ? "Delete" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
