"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { LayoutTemplate } from "lucide-react";

import { listTemplates, saveAsTemplate, type TemplateSummary } from "@/app/actions/templates";
import type { TemplateKind } from "@/lib/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const KEEPS: Record<TemplateKind, string> = {
  project:
    "Keeps the phases, deliverables, milestones, storyboards, objectives, assessment items, and the project's boards with their cards (all back in to-do). Dates become relative to the start date you pick when you use it. People, statuses, comments, reviews, files and time aren't copied.",
  storyboard: "Keeps every screen with its type and all its text. Comments and objective links aren't copied.",
};

/** "Save as template" for a project or a storyboard page. */
export function SaveAsTemplate({ kind, sourceId, sourceName }: { kind: TemplateKind; sourceId: string; sourceName: string }) {
  const [open, setOpen] = useState(false);
  const [existing, setExisting] = useState<TemplateSummary[]>([]);
  const [replaceId, setReplaceId] = useState("");
  const [name, setName] = useState(sourceName);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function openDialog() {
    setError(null);
    setDone(null);
    setReplaceId("");
    setName(sourceName);
    setOpen(true);
    listTemplates(kind).then((t) => setExisting(t.filter((x) => x.canManage)), () => setExisting([]));
  }

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await saveAsTemplate({
        kind,
        sourceId,
        name: String(fd.get("name") ?? ""),
        description: String(fd.get("description") ?? ""),
        replaceId: replaceId || null,
      });
      if ("error" in res) return setError(res.error ?? "Couldn't save the template.");
      setDone(res.replaced ? "Template updated." : "Saved as a template.");
    });
  }

  return (
    <>
      <Button variant="ghost" onClick={openDialog}>
        <LayoutTemplate className="size-4" aria-hidden="true" />
        Save as template
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="top-1/3 max-w-md rounded-xl bg-surface p-5 shadow-2xl">
          <DialogTitle className="mb-1 flex items-center gap-2 text-sm font-medium">
            <LayoutTemplate className="size-4 text-accent" aria-hidden="true" /> Save this {kind} as a template
          </DialogTitle>
          <DialogDescription className="mb-3 text-xs text-muted-foreground">{KEEPS[kind]}</DialogDescription>
          {done ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="text-sm">
                {done} Anyone in the workspace can now start a {kind} from it.
              </p>
              <div className="flex justify-end gap-2">
                <Button asChild variant="ghost">
                  <Link href="/templates">See templates</Link>
                </Button>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </div>
            </div>
          ) : (
            <form action={submit} className="flex flex-col gap-3">
              {existing.length > 0 && (
                <Select
                  value={replaceId}
                  onChange={(e) => {
                    setReplaceId(e.target.value);
                    const t = existing.find((x) => x.id === e.target.value);
                    setName(t ? t.name : sourceName);
                  }}
                  aria-label="Save as"
                >
                  <option value="">Save as a new template</option>
                  {existing.map((t) => (
                    <option key={t.id} value={t.id}>
                      Replace &ldquo;{t.name}&rdquo;
                    </option>
                  ))}
                </Select>
              )}
              <Input name="name" required maxLength={140} value={name} onChange={(e) => setName(e.target.value)} aria-label="Template name" placeholder="Template name" />
              <Textarea
                key={replaceId}
                name="description"
                rows={2}
                maxLength={2000}
                defaultValue={existing.find((x) => x.id === replaceId)?.description ?? ""}
                placeholder="What it's for (optional)"
                aria-label="Template description"
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">Everyone in the workspace can see and use templates, even if this {kind} is restricted to some groups.</p>
              {error && (
                <p role="status" className="text-sm text-destructive-ink">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {replaceId ? "Replace template" : "Save template"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
