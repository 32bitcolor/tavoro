"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone } from "lucide-react";

import { flagContentChange } from "@/app/actions/content";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Impacted = { id: string; title: string; status: string; depth: number };

/** "This changed…": preview what depends on it, then flag those items for review. */
export function FlagChangeButton({
  origin,
  name,
  impact,
  size = "sm",
}: {
  origin: { contentId: string } | { externalSource: string };
  name: string;
  impact: Impacted[];
  size?: "sm" | "xs";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const live = impact.filter((i) => i.status !== "draft");
  const drafts = impact.length - live.length;

  function confirm() {
    setError(null);
    start(async () => {
      const res = await flagContentChange(origin, note.trim() || null);
      if ("error" in res) return setError(res.error ?? "Couldn't flag them.");
      setOpen(false);
      setNote("");
      const n = res.flagged.length;
      setResult(
        n || res.drafts
          ? `Flagged ${n} item${n === 1 ? "" : "s"} for review${res.drafts ? ` and noted it on ${res.drafts} draft${res.drafts === 1 ? "" : "s"}` : ""}. Their owners have been told.`
          : "Nothing depends on it any more.",
      );
      router.refresh();
    });
  }

  return (
    <>
      <Button size={size} variant="outline" disabled={!impact.length} onClick={() => setOpen(true)} title={impact.length ? undefined : "Nothing depends on this yet"}>
        <Megaphone className="size-4" aria-hidden="true" /> This changed…
      </Button>
      {result && (
        <p role="status" className="text-sm text-muted-foreground">
          {result}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md rounded-xl bg-surface p-5 shadow-2xl">
          <DialogTitle className="text-base font-semibold">“{name}” changed</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {live.length > 0 && (
              <>
                {live.length} item{live.length === 1 ? "" : "s"} that depend{live.length === 1 ? "s" : ""} on it will be marked{" "}
                <strong>Needs review</strong>, and {live.length === 1 ? "its owner" : "their owners"} emailed.{" "}
              </>
            )}
            {drafts > 0 && (
              <>
                {drafts} draft{drafts === 1 ? "" : "s"} will get a note but keep {drafts === 1 ? "its" : "their"} status.
              </>
            )}
          </DialogDescription>
          <ul className="max-h-48 overflow-y-auto rounded-md border border-border text-sm">
            {impact.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
                <span className="truncate">{i.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {i.status === "draft" ? "Draft" : i.depth > 1 ? "Indirectly" : "Directly"}
                </span>
              </li>
            ))}
          </ul>
          <label htmlFor="flag-note" className="text-sm font-medium">
            What changed? <span className="font-normal text-muted-foreground">(optional, included in the email)</span>
          </label>
          <Textarea id="flag-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Section 4.2 now requires two-factor checks before sharing results." />
          {error && <p className="text-sm text-destructive-ink">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={pending}>
              Flag {impact.length} for review
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
