"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, X } from "lucide-react";

import { addContentDependency, removeContentDependency } from "@/app/actions/content";
import { SectionHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PickDialog, type PickOption } from "@/components/assets/pick-dialog";
import { FlagChangeButton } from "@/components/content/flag-change";

type Ref = { id: string; title: string; retired: boolean };

/** On a content item: what it depends on, what depends on it, and "This changed…". */
export function ContentDependencies({
  contentId,
  title,
  dependsOn,
  dependedOnBy,
  impact,
  contentOptions,
  sourceSuggestions,
}: {
  contentId: string;
  title: string;
  dependsOn: { id: string; note: string | null; target: Ref | null; externalSource: string | null }[];
  dependedOnBy: { id: string; note: string | null; source: Ref }[];
  impact: { id: string; title: string; status: string; depth: number }[];
  contentOptions: PickOption[];
  sourceSuggestions: string[];
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [outside, setOutside] = useState(false);
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ error?: string } | object>, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if ("error" in res && res.error) setError(res.error);
      else {
        after?.();
        router.refresh();
      }
    });
  }

  const retired = (r: Ref) => (r.retired ? <span className="text-xs text-muted-foreground"> (retired)</span> : null);

  return (
    <section>
      <SectionHeader>Dependencies</SectionHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-medium">Depends on</h3>
          {dependsOn.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing recorded. Add the policies, systems and other content this relies on, so a change to them flags it for review.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {dependsOn.map((d) => (
                <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {d.target ? (
                      <Link href={`/content/${d.target.id}`} className="font-medium hover:underline">
                        {d.target.title}
                      </Link>
                    ) : (
                      <>
                        <ExternalLink className="mr-1 inline size-3.5 text-muted-foreground" aria-label="Outside Tavoro" />
                        <Link href={`/content/sources?source=${encodeURIComponent(d.externalSource!)}`} className="font-medium hover:underline">
                          {d.externalSource}
                        </Link>
                      </>
                    )}
                    {d.target && retired(d.target)}
                  </span>
                  <Button size="icon" variant="ghost" className="size-7" aria-label={`Remove ${d.target?.title ?? d.externalSource}`} disabled={pending} onClick={() => run(() => removeContentDependency(d.id))}>
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
              <Plus className="size-4" aria-hidden="true" /> Other content
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOutside(true)}>
              <Plus className="size-4" aria-hidden="true" /> Something outside Tavoro
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-medium">Depended on by</h3>
          {dependedOnBy.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other content records that it depends on this.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {dependedOnBy.map((d) => (
                <li key={d.id} className="px-3 py-2 text-sm">
                  <Link href={`/content/${d.source.id}`} className="font-medium hover:underline">
                    {d.source.title}
                  </Link>
                  {retired(d.source)}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col items-start gap-1">
            <FlagChangeButton origin={{ contentId }} name={title} impact={impact} />
            {impact.length > dependedOnBy.length && (
              <p className="text-xs text-muted-foreground">
                {impact.length} item{impact.length === 1 ? "" : "s"} depend on it, counting content that depends on those.
              </p>
            )}
          </div>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-destructive-ink">{error}</p>}

      <PickDialog
        open={picking}
        onOpenChange={setPicking}
        title="It depends on…"
        options={contentOptions}
        empty="No other content in the inventory."
        onPick={(id) => {
          setPicking(false);
          run(() => addContentDependency(contentId, { targetId: id }));
        }}
      />
      <Dialog open={outside} onOpenChange={setOutside}>
        <DialogContent showCloseButton={false} className="top-1/3 max-w-sm rounded-xl bg-surface p-5 shadow-2xl">
          <DialogTitle className="mb-1 text-sm font-medium">It depends on something outside Tavoro</DialogTitle>
          <DialogDescription className="mb-3 text-xs text-muted-foreground">
            A policy, a system, a regulation, a product feature. Use the same name each time, so one change finds everything that depends on it.
          </DialogDescription>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => addContentDependency(contentId, { externalSource: source }),
                () => {
                  setOutside(false);
                  setSource("");
                },
              );
            }}
          >
            <Input value={source} onChange={(e) => setSource(e.target.value)} list="dep-sources" autoFocus required maxLength={200} placeholder="e.g. Privacy policy 4.2" aria-label="What it depends on" />
            <datalist id="dep-sources">
              {sourceSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {error && <p className="text-sm text-destructive-ink">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOutside(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                Add
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
