"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Download, ExternalLink, Plus, RefreshCw, Trash2, X } from "lucide-react";

import { attachAsset, deleteAsset, detachAsset, setAssetArchived, setAssetLabels, updateAsset, type AssetFields } from "@/app/actions/assets";
import { ASSET_TYPES, ASSET_TYPE_LABEL, formatBytes, previewKind, type AssetType } from "@/lib/asset-types";
import { useSetPageTitle } from "@/components/app-shell/breadcrumbs";
import { InlineTitle } from "@/components/shared/inline-title";
import { ConfirmDelete } from "@/components/shared/confirm-delete";
import { StatusBadge } from "@/components/shared/status-badge";
import { SectionHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AssetThumb } from "@/components/assets/asset-thumb";
import { PickDialog, type PickOption } from "@/components/assets/pick-dialog";
import { uploadAsset } from "@/components/assets/upload-assets";
import { cn } from "@/lib/utils";

type Asset = {
  id: string;
  name: string;
  description: string | null;
  assetType: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  externalUrl: string | null;
  fileUrl: string | null;
  archived: boolean;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
  labelIds: string[];
};

type Form = { assetType: string; description: string; externalUrl: string };
const formOf = (a: Asset): Form => ({ assetType: a.assetType, description: a.description ?? "", externalUrl: a.externalUrl ?? "" });

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Preview({ asset }: { asset: Asset }) {
  const kind = asset.fileUrl ? previewKind(asset.mimeType) : null;
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- private, served by our own route
      <img src={asset.fileUrl!} alt={asset.description || asset.name} className="mx-auto max-h-[28rem] w-auto rounded-md object-contain" />
    );
  }
  if (kind === "video") {
    return <video src={asset.fileUrl!} controls preload="metadata" className="mx-auto max-h-[28rem] w-full rounded-md bg-black" />;
  }
  if (kind === "audio") return <audio src={asset.fileUrl!} controls preload="metadata" className="w-full" />;
  return (
    <div className="mx-auto aspect-[4/3] w-40 overflow-hidden rounded-md border border-border">
      <AssetThumb asset={asset} />
    </div>
  );
}

export function AssetDetail({
  asset,
  usedIn,
  contentOptions,
  labels,
  canDelete,
}: {
  asset: Asset;
  usedIn: { id: string; title: string; type: string; retired: boolean }[];
  contentOptions: PickOption[];
  labels: { id: string; name: string; color: string }[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(asset.name);
  const [form, setForm] = useState<Form>(() => formOf(asset));
  const [labelIds, setLabelIds] = useState(() => new Set(asset.labelIds));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [replacing, setReplacing] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [pending, start] = useTransition();
  const [seen, setSeen] = useState(asset.updatedAt);
  if (seen !== asset.updatedAt) {
    setSeen(asset.updatedAt);
    setForm(formOf(asset));
  }
  useSetPageTitle(name, [{ label: "Assets", href: "/assets" }]);

  const saved = formOf(asset);
  const dirty = (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== saved[k]);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const isFile = !!asset.fileUrl;

  function run(fn: () => Promise<unknown>, ok?: string) {
    setMessage(null);
    start(async () => {
      const res = (await fn()) as { error?: string } | undefined;
      if (res && "error" in res && res.error) setMessage({ tone: "error", text: res.error });
      else {
        if (ok) setMessage({ tone: "ok", text: ok });
        router.refresh();
      }
    });
  }

  function save() {
    const patch: Partial<AssetFields> = {
      assetType: form.assetType as AssetType,
      description: form.description.trim() || null,
      ...(!isFile ? { externalUrl: form.externalUrl.trim() } : {}),
    };
    run(() => updateAsset(asset.id, patch), "Saved.");
  }

  function toggleLabel(id: string) {
    const next = new Set(labelIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setLabelIds(next);
    run(() => setAssetLabels(asset.id, [...next]));
  }

  async function replace(f: File) {
    setMessage(null);
    setReplacing(0);
    try {
      await uploadAsset(f, setReplacing, asset.id);
      setMessage({ tone: "ok", text: isFile ? "File replaced. Everything that uses this asset now gets the new file." : "File uploaded." });
      router.refresh();
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setReplacing(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <InlineTitle
          value={name}
          onChange={setName}
          onCommit={() => name.trim() && name !== asset.name && run(() => updateAsset(asset.id, { name }))}
          ariaLabel="Asset name"
          className="text-2xl font-semibold tracking-tight"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          {asset.archived && <StatusBadge tone="neutral">Archived</StatusBadge>}
          <span className="min-w-0 break-words">
            {[
              ASSET_TYPE_LABEL[asset.assetType as AssetType] ?? asset.assetType,
              isFile ? asset.fileName : "Link",
              isFile ? formatBytes(asset.sizeBytes) : null,
              `Added ${new Date(asset.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${asset.uploadedBy ? ` by ${asset.uploadedBy}` : ""}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </div>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <Preview asset={asset} />
        <div className="flex flex-wrap items-center justify-center gap-2">
          {isFile ? (
            <>
              {previewKind(asset.mimeType) === "pdf" && (
                <Button asChild size="sm" variant="outline">
                  <a href={asset.fileUrl!} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" aria-hidden="true" /> Open
                  </a>
                </Button>
              )}
              <Button asChild size="sm" variant="outline">
                <a href={`${asset.fileUrl}&download`}>
                  <Download className="size-4" aria-hidden="true" /> Download
                </a>
              </Button>
            </>
          ) : (
            asset.externalUrl && (
              <Button asChild size="sm" variant="outline">
                <a href={asset.externalUrl} target="_blank" rel="noopener noreferrer nofollow">
                  <ExternalLink className="size-4" aria-hidden="true" /> Open link
                </a>
              </Button>
            )
          )}
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void replace(f);
            }}
          />
          <Button size="sm" variant="ghost" disabled={replacing != null} onClick={() => fileInput.current?.click()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {replacing != null ? `Uploading ${Math.round(replacing * 100)}%` : isFile ? "Replace file" : "Upload a file instead"}
          </Button>
        </div>
      </section>

      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <section>
          <SectionHeader>Details</SectionHeader>
          <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label="Type" htmlFor="a-type">
              <Select id="a-type" value={form.assetType} onChange={set("assetType")}>
                {ASSET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ASSET_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            {!isFile && (
              <Field label="Link" htmlFor="a-url" hint="Where the asset really lives.">
                <Input id="a-url" type="url" value={form.externalUrl} onChange={set("externalUrl")} placeholder="https://" />
              </Field>
            )}
            <div className="sm:col-span-2">
              <Field label="Description" htmlFor="a-desc" hint="What it is, where it came from, any licence or usage terms. For images, this is also the alt text.">
                <Textarea id="a-desc" rows={3} value={form.description} onChange={set("description")} maxLength={5000} />
              </Field>
            </div>
          </div>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!dirty || pending}>
            Save changes
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => setForm(saved)}>
              Discard
            </Button>
          )}
          {message && (
            <p role="status" className={cn("text-sm", message.tone === "error" ? "text-destructive-ink" : "text-muted-foreground")}>
              {message.text}
            </p>
          )}
        </div>
      </form>

      {labels.length > 0 && (
        <section>
          <SectionHeader>Labels</SectionHeader>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Labels">
            {labels.map((l) => {
              const on = labelIds.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleLabel(l.id)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    on ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:border-border-strong",
                  )}
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: l.color }} aria-hidden="true" />
                  {l.name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <SectionHeader action={<Button size="sm" variant="ghost" onClick={() => setPicking(true)}><Plus className="size-4" aria-hidden="true" /> Add to content</Button>}>
          Used in
        </SectionHeader>
        {usedIn.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not used in any content in the inventory yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {usedIn.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Link href={`/content/${c.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {c.title}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {c.type}
                  {c.retired ? " · Retired" : ""}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={`Remove from ${c.title}`}
                  disabled={pending}
                  onClick={() => run(() => detachAsset(c.id, asset.id))}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <PickDialog
          open={picking}
          onOpenChange={setPicking}
          title="Add to content"
          options={contentOptions}
          empty="No other content in the inventory."
          onPick={(id) => {
            setPicking(false);
            run(() => attachAsset(id, asset.id));
          }}
        />
      </section>

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => setAssetArchived(asset.id, !asset.archived), asset.archived ? "Restored." : "Archived.")}
        >
          {asset.archived ? <ArchiveRestore className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}
          {asset.archived ? "Restore" : "Archive"}
        </Button>
        {canDelete && (
          <ConfirmDelete
            title="Delete this asset?"
            description={`The ${isFile ? "file is deleted" : "link is removed"} and it disappears from ${usedIn.length ? `the ${usedIn.length} content item${usedIn.length === 1 ? "" : "s"} that use it` : "the library"}. To take it off the shelf but keep the record, archive it instead.`}
            onConfirm={async () => {
              const res = await deleteAsset(asset.id);
              if ("error" in res) return res;
              router.push("/assets");
            }}
            trigger={
              <Button variant="ghost" size="sm" className="text-destructive-ink">
                <Trash2 className="size-4" aria-hidden="true" /> Delete
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
