"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type PickOption = { id: string; label: string; hint?: string };

/** A searchable list to choose one thing from (an asset for content, content for an asset). */
export function PickDialog({
  open,
  onOpenChange,
  title,
  options,
  empty,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  options: PickOption[];
  empty: string;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (needle ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(needle)) : options).slice(0, 100);
  }, [q, options]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setQ("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="top-1/4 max-w-md translate-y-0 rounded-xl bg-surface p-0 shadow-2xl">
        <DialogTitle className="px-4 pt-4 text-sm font-medium">{title}</DialogTitle>
        <DialogDescription className="sr-only">Search, then choose one.</DialogDescription>
        <div className="relative px-4">
          <Search className="pointer-events-none absolute left-6.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search…" aria-label="Search" className="pl-8" />
        </div>
        <ul className="max-h-80 overflow-y-auto px-2 pb-2" aria-label={title}>
          {shown.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">{options.length ? "Nothing matches." : empty}</li>}
          {shown.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  onPick(o.id);
                }}
                className="flex w-full flex-col items-start rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
              >
                <span className="font-medium">{o.label}</span>
                {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
