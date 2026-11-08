import Link from "next/link";
import { redirect } from "next/navigation";
import { Images } from "lucide-react";

import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { listAssets } from "@/lib/assets";
import { ASSET_TYPE_LABEL, formatBytes, type AssetType } from "@/lib/asset-types";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { LabelPill } from "@/components/shared/work-item";
import { AssetThumb } from "@/components/assets/asset-thumb";
import { AssetFilters } from "@/components/assets/asset-filters";
import { UploadAssets } from "@/components/assets/upload-assets";
import { AddLinkButton } from "@/components/assets/add-link-button";

export const metadata = { title: "Assets · Tavoro" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function AssetsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const sp = await searchParams;
  const filters = { q: one(sp.q), type: one(sp.type), labelId: one(sp.label), archived: one(sp.archived), unused: one(sp.unused) };
  const filtered = Object.values(filters).some(Boolean);

  const [assets, total, labels] = await Promise.all([
    listAssets(membership.workspaceId, filters),
    prisma.asset.count({ where: { workspaceId: membership.workspaceId } }),
    prisma.label.findMany({ where: { workspaceId: membership.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const actions = (drop: boolean) => (
    <div className="flex flex-wrap items-start gap-2">
      <AddLinkButton />
      <UploadAssets dropTarget={drop} />
    </div>
  );

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Assets"
        description="The team's shared shelf: images, video, audio, documents and source files to reuse, and the content that uses them."
        actions={actions(true)}
      />

      {(total > 0 || filtered) && (
        <div className="mt-6">
          <AssetFilters labels={labels} />
        </div>
      )}

      {assets.length === 0 ? (
        filtered ? (
          <EmptyState className="mt-6" icon={Images} title="Nothing matches" description="Try a different filter, or clear them to see the whole library." />
        ) : (
          <EmptyState
            className="mt-8"
            icon={Images}
            title="No assets yet"
            description="Upload the images, video, audio and source files your team keeps reusing, or link to where they live, and tag them with labels so the next project finds them. You can drop files anywhere on this page."
            action={actions(false)}
          />
        )
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {assets.map((a) => (
            <li key={a.id} className="min-w-0">
              <Link
                href={`/assets/${a.id}`}
                className="group block overflow-hidden rounded-lg border border-border bg-surface outline-none transition-colors hover:border-border-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <div className="aspect-[4/3] overflow-hidden border-b border-border">
                  <AssetThumb asset={a} />
                </div>
                <div className="flex flex-col gap-1 px-3 py-2">
                  <span className="truncate text-sm font-medium group-hover:underline">{a.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {ASSET_TYPE_LABEL[a.assetType as AssetType] ?? a.assetType}
                    {a.sizeBytes != null ? ` · ${formatBytes(a.sizeBytes)}` : a.externalUrl ? " · Link" : ""}
                    {a.usedIn > 0 ? ` · Used in ${a.usedIn}` : ""}
                  </span>
                  {a.labels.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {a.labels.slice(0, 3).map((l) => (
                        <LabelPill key={l.id} label={l} />
                      ))}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
