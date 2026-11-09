"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, Plus, Trash2, X } from "lucide-react";
import { listSavedViews, saveView, deleteSavedView, type SavedViewDTO } from "@/app/actions/saved-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Views dropdown shared by the board filter bar and the team sprint board.
 *  The parent owns the live filter state; this only reads it (`currentFilters`)
 *  when saving and writes it back (`onApply`) when a view is picked. */
export function SavedViewsMenu({
  scope,
  boardId,
  currentFilters,
  filtersActive,
  activeViewId,
  onApply,
}: {
  scope: "board" | "sprint" | "query";
  boardId?: string;
  currentFilters: () => unknown;
  filtersActive: boolean;
  activeViewId: string | null;
  onApply: (view: SavedViewDTO | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedViewDTO[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    if (scope === "board" && !boardId) return;
    listSavedViews(scope, boardId).then((v) => {
      if (!active) return;
      setViews(v);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [scope, boardId]);

  useEffect(() => {
    if (naming) nameRef.current?.focus();
  }, [naming]);

  function reset() {
    setNaming(false);
    setName("");
    setError(null);
  }

  async function save() {
    const res = await saveView(scope, boardId ?? null, name, currentFilters());
    if ("error" in res && res.error) {
      setError(res.error);
      return;
    }
    if (!("view" in res) || !res.view) return;
    const view = res.view;
    setViews((prev) => {
      const rest = prev.filter((v) => v.id !== view.id);
      return [...rest, view].sort((a, b) => a.name.localeCompare(b.name));
    });
    onApply(view);
    reset();
    setOpen(false);
  }

  async function remove(id: string) {
    const res = await deleteSavedView(id);
    if (res && "error" in res && res.error) return;
    setViews((prev) => prev.filter((v) => v.id !== id));
    if (activeViewId === id) onApply(null);
  }

  const activeName = views.find((v) => v.id === activeViewId)?.name;

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
        <Bookmark className="size-4" />
        {activeName ?? "Views"}
        {views.length > 0 && !activeName && (
          <span className="rounded bg-accent px-1 text-xs text-accent-foreground">{views.length}</span>
        )}
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); reset(); }} />
          <div className="absolute z-20 mt-1 w-64 rounded-md border border-border bg-surface py-1 shadow-lg">
            {loaded && views.length === 0 && !naming && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No saved views yet. Set some filters, then save them here.
              </p>
            )}

            {views.map((v) => (
              <div key={v.id} className="flex items-center gap-1 pr-1 hover:bg-hover">
                <button
                  onClick={() => { onApply(v); setOpen(false); }}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm"
                >
                  <span className="flex w-3 shrink-0 items-center text-foreground/70">
                    {activeViewId === v.id && <Check className="size-3.5" />}
                  </span>
                  <span className="truncate">{v.name}</span>
                </button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive-ink"
                  title={`Delete "${v.name}"`}
                  aria-label={`Delete view ${v.name}`}
                  onClick={() => remove(v.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}

            <div className="mt-1 border-t border-border pt-1">
              {activeViewId && (
                <button
                  onClick={() => { onApply(null); setOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover"
                >
                  <X className="size-3.5 text-muted-foreground" /> Clear view
                </button>
              )}

              {naming ? (
                <div className="px-2 py-1.5">
                  <Input
                    ref={nameRef}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save();
                      if (e.key === "Escape") reset();
                    }}
                    placeholder="View name…"
                    className="h-8 text-xs"
                  />
                  {error && <p className="mt-1 text-xs text-destructive-ink">{error}</p>}
                  <div className="mt-1.5 flex gap-1.5">
                    <Button size="sm" onClick={save} disabled={!name.trim()}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => (filtersActive ? setNaming(true) : setError("Set a filter first."))}
                  disabled={!filtersActive}
                  title={filtersActive ? undefined : "Set at least one filter first"}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="size-3.5" /> Save current filters…
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
