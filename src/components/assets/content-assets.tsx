"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import { attachAsset, detachAsset } from "@/app/actions/assets";
import { SectionHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { AssetThumb } from "@/components/assets/asset-thumb";
import { PickDialog, type PickOption } from "@/components/assets/pick-dialog";

type Attached = { id: string; name: string; assetType: string; mimeType: string | null; fileUrl: string | null; externalUrl: string | null; hint: string };

/** On a content item: the library assets it uses, and a picker to add more. */
export function ContentAssets({ contentId, assets, options }: { contentId: string; assets: Attached[]; options: PickOption[] }) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ error?: string } | { ok: true }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if ("error" in res && res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <section>
      <SectionHeader
        action={
          <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
            <Plus className="size-4" aria-hidden="true" /> Add from library
          </Button>
        }
      >
        Assets
      </SectionHeader>
      {assets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No library assets recorded. Add the images, video and source files this uses, so the{" "}
          <Link href="/assets" className="text-link">
            asset library
          </Link>{" "}
          can say where each one is used.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {assets.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="size-10 shrink-0 overflow-hidden rounded border border-border">
                <AssetThumb asset={a} />
              </span>
              <Link href={`/assets/${a.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {a.name}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground">{a.hint}</span>
              <Button size="icon" variant="ghost" className="size-7" aria-label={`Remove ${a.name}`} disabled={pending} onClick={() => run(() => detachAsset(contentId, a.id))}>
                <X className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-destructive-ink">{error}</p>}
      <PickDialog
        open={picking}
        onOpenChange={setPicking}
        title="Add an asset from the library"
        options={options}
        empty="The library has no other assets yet."
        onPick={(id) => {
          setPicking(false);
          run(() => attachAsset(contentId, id));
        }}
      />
    </section>
  );
}
