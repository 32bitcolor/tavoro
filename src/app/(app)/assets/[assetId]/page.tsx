import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { getAssetForUser } from "@/lib/authz";
import { ASSET_SELECT, toAssetRow } from "@/lib/assets";
import { CONTENT_TYPE_LABEL, type ContentType } from "@/lib/content";
import { AssetDetail } from "@/components/assets/asset-detail";
import { PageContainer } from "@/components/shared/page";
import { Role } from "@/generated/prisma/client";

export const metadata = { title: "Assets · Tavoro" };

export default async function AssetPage({ params }: { params: Promise<{ assetId: string }> }) {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const { assetId } = await params;
  const access = await getAssetForUser(assetId);
  if (!access || access.workspaceId !== membership.workspaceId) notFound();

  const [row, usedIn, content, labels] = await Promise.all([
    prisma.asset.findUniqueOrThrow({ where: { id: assetId }, select: ASSET_SELECT }),
    prisma.contentItemAsset.findMany({
      where: { assetId },
      select: { contentItem: { select: { id: true, title: true, contentType: true, status: true } } },
      orderBy: { contentItem: { title: "asc" } },
    }),
    prisma.contentItem.findMany({
      where: { workspaceId: membership.workspaceId, status: { not: "retired" } },
      select: { id: true, title: true, contentType: true },
      orderBy: { title: "asc" },
      take: 1000,
    }),
    prisma.label.findMany({ where: { workspaceId: membership.workspaceId }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" } }),
  ]);
  const asset = toAssetRow(row);
  const used = new Set(usedIn.map((u) => u.contentItem.id));
  const manager = membership.role === Role.ADMIN || membership.role === Role.MANAGER;

  return (
    <PageContainer>
      <AssetDetail
        asset={{
          id: asset.id,
          name: asset.name,
          description: asset.description,
          assetType: asset.assetType,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          externalUrl: asset.externalUrl,
          fileUrl: asset.fileUrl,
          archived: !!asset.archivedAt,
          uploadedBy: asset.uploadedBy ? (asset.uploadedBy.name ?? asset.uploadedBy.email) : null,
          createdAt: asset.createdAt.toISOString(),
          updatedAt: asset.updatedAt.toISOString(),
          labelIds: asset.labels.map((l) => l.id),
        }}
        usedIn={usedIn.map((u) => ({
          id: u.contentItem.id,
          title: u.contentItem.title,
          type: CONTENT_TYPE_LABEL[u.contentItem.contentType as ContentType] ?? u.contentItem.contentType,
          retired: u.contentItem.status === "retired",
        }))}
        contentOptions={content
          .filter((c) => !used.has(c.id))
          .map((c) => ({ id: c.id, label: c.title, hint: CONTENT_TYPE_LABEL[c.contentType as ContentType] ?? c.contentType }))}
        labels={labels}
        canDelete={manager || access.uploadedById === membership.userId}
      />
    </PageContainer>
  );
}
