import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { getContentItemForUser } from "@/lib/authz";
import { CONTENT_SELECT, attentionReason } from "@/lib/content-inventory";
import { lifecycleOf } from "@/lib/content";
import { ContentDetail } from "@/components/content/content-detail";
import { PageContainer } from "@/components/shared/page";
import { ContentAssets } from "@/components/assets/content-assets";
import { assetFileUrl } from "@/lib/assets";
import { ASSET_TYPE_LABEL, formatBytes, type AssetType } from "@/lib/asset-types";
import { Role } from "@/generated/prisma/client";

const ASSET_PICK = { id: true, name: true, assetType: true, mimeType: true, storageKey: true, sizeBytes: true, externalUrl: true } as const;

export const metadata = { title: "Content · Tavoro" };

export default async function ContentItemPage({ params }: { params: Promise<{ contentId: string }> }) {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const { contentId } = await params;
  const access = await getContentItemForUser(contentId);
  if (!access || access.workspaceId !== membership.workspaceId) notFound();

  const [item, members, labels, attached, library] = await Promise.all([
    prisma.contentItem.findUniqueOrThrow({ where: { id: contentId }, select: CONTENT_SELECT }),
    prisma.membership.findMany({
      where: { workspaceId: membership.workspaceId, suspendedAt: null },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.label.findMany({ where: { workspaceId: membership.workspaceId }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" } }),
    prisma.contentItemAsset.findMany({
      where: { contentItemId: contentId },
      select: { asset: { select: ASSET_PICK } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.asset.findMany({
      where: { workspaceId: membership.workspaceId, archivedAt: null, contentItems: { none: { contentItemId: contentId } } },
      select: ASSET_PICK,
      orderBy: { name: "asc" },
      take: 1000,
    }),
  ]);
  const hint = (a: { assetType: string; sizeBytes: number | null; externalUrl: string | null }) =>
    [ASSET_TYPE_LABEL[a.assetType as AssetType] ?? a.assetType, a.sizeBytes != null ? formatBytes(a.sizeBytes) : a.externalUrl ? "Link" : null]
      .filter(Boolean)
      .join(" · ");
  const lifecycle = lifecycleOf(item);

  return (
    <PageContainer>
      <ContentDetail
        item={{
          id: item.id,
          title: item.title,
          description: item.description,
          contentType: item.contentType,
          status: item.status,
          externalUrl: item.externalUrl,
          ownerId: item.owner?.id ?? null,
          publishedAt: item.publishedAt?.toISOString() ?? null,
          reviewDate: item.reviewDate?.toISOString() ?? null,
          reviewIntervalMonths: item.reviewIntervalMonths,
          lastReviewedAt: item.lastReviewedAt?.toISOString() ?? null,
          expiryDate: item.expiryDate?.toISOString() ?? null,
          project: item.project,
          deliverable: item.deliverable,
          labelIds: item.labels.map((l) => l.label.id),
          lifecycle,
          updatedAt: item.updatedAt.toISOString(),
          reason: attentionReason({ lifecycle, reviewDate: item.reviewDate, expiryDate: item.expiryDate }),
        }}
        members={members.map((m) => ({ id: m.user.id, label: m.user.name ?? m.user.email }))}
        labels={labels}
        canDelete={membership.role === Role.ADMIN || membership.role === Role.MANAGER}
      >
        <ContentAssets
          contentId={item.id}
          assets={attached.map(({ asset: a }) => ({
            id: a.id,
            name: a.name,
            assetType: a.assetType,
            mimeType: a.mimeType,
            externalUrl: a.externalUrl,
            fileUrl: assetFileUrl(a),
            hint: hint(a),
          }))}
          options={library.map((a) => ({ id: a.id, label: a.name, hint: hint(a) }))}
        />
      </ContentDetail>
    </PageContainer>
  );
}
