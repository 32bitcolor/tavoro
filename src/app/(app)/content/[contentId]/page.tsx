import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { getContentItemForUser } from "@/lib/authz";
import { CONTENT_SELECT, attentionReason } from "@/lib/content-inventory";
import { lifecycleOf } from "@/lib/content";
import { ContentDetail } from "@/components/content/content-detail";
import { PageContainer, SectionHeader } from "@/components/shared/page";
import { ContentAssets } from "@/components/assets/content-assets";
import { ContentDependencies } from "@/components/content/content-dependencies";
import { externalSources, impactOf } from "@/lib/content-impact";
import { assetFileUrl } from "@/lib/assets";
import { ASSET_TYPE_LABEL, formatBytes, type AssetType } from "@/lib/asset-types";
import { LiveResults } from "@/components/suite/live-results";
import type { CourseSummary } from "@/lib/courseforge";
import { Role } from "@/generated/prisma/client";

const ASSET_PICK = { id: true, name: true, assetType: true, mimeType: true, storageKey: true, sizeBytes: true, externalUrl: true } as const;

export const metadata = { title: "Content · Tavoro" };

export default async function ContentItemPage({ params }: { params: Promise<{ contentId: string }> }) {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const { contentId } = await params;
  const access = await getContentItemForUser(contentId);
  if (!access || access.workspaceId !== membership.workspaceId) notFound();

  const [item, members, labels, attached, library, dependsOn, dependedOnBy, impact, sources, allContent] = await Promise.all([
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
    prisma.contentDependency.findMany({
      where: { sourceId: contentId },
      select: { id: true, externalSource: true, note: true, target: { select: { id: true, title: true, status: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.contentDependency.findMany({
      where: { targetId: contentId },
      select: { id: true, note: true, source: { select: { id: true, title: true, status: true } } },
      orderBy: { createdAt: "asc" },
    }),
    impactOf(membership.workspaceId, { contentId }),
    externalSources(membership.workspaceId),
    prisma.contentItem.findMany({
      where: { workspaceId: membership.workspaceId, id: { not: contentId } },
      select: { id: true, title: true, contentType: true, status: true },
      orderBy: { title: "asc" },
      take: 1000,
    }),
  ]);
  const hint = (a: { assetType: string; sizeBytes: number | null; externalUrl: string | null }) =>
    [ASSET_TYPE_LABEL[a.assetType as AssetType] ?? a.assetType, a.sizeBytes != null ? formatBytes(a.sizeBytes) : a.externalUrl ? "Link" : null]
      .filter(Boolean)
      .join(" · ");
  const lifecycle = lifecycleOf(item);
  // In the LMS (docs/SUITE.md, step 5): the CourseForge course on the deliverable's card, when it has live packages.
  // A private card's course stays out of the inventory.
  const lmsCard = item.deliverable
    ? await prisma.deliverable.findUnique({
        where: { id: item.deliverable.id },
        select: { card: { select: { private: true, course: { select: { courseId: true, title: true, missing: true, summary: true, app: { select: { name: true, url: true } } } } } } },
      })
    : null;
  const lmsCourse = lmsCard?.card && !lmsCard.card.private && lmsCard.card.course && !lmsCard.card.course.missing ? lmsCard.card.course : null;
  const lms = lmsCourse ? (lmsCourse.summary as unknown as CourseSummary | null) : null;

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
          reason:
            attentionReason({ lifecycle, reviewDate: item.reviewDate, expiryDate: item.expiryDate, needsReviewReason: item.needsReviewReason }) ??
            (item.needsReviewReason ? `Flagged for review: ${item.needsReviewReason}` : null),
        }}
        members={members.map((m) => ({ id: m.user.id, label: m.user.name ?? m.user.email }))}
        labels={labels}
        canDelete={membership.role === Role.ADMIN || membership.role === Role.MANAGER}
      >
        {lmsCourse && lms?.live && (
          <section>
            <SectionHeader>In the LMS</SectionHeader>
            <div className="rounded-md border border-border p-3">
              <a href={lms.url ?? `${lmsCourse.app.url}/courses/${lmsCourse.courseId}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                {lmsCourse.title}
                <span className="sr-only"> (opens {lmsCourse.app.name})</span>
              </a>
              <div className="mt-1.5">
                <LiveResults live={lms.live} />
              </div>
            </div>
          </section>
        )}
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
        <ContentDependencies
          contentId={item.id}
          title={item.title}
          dependsOn={dependsOn.map((d) => ({
            id: d.id,
            note: d.note,
            target: d.target ? { id: d.target.id, title: d.target.title, retired: d.target.status === "retired" } : null,
            externalSource: d.externalSource,
          }))}
          dependedOnBy={dependedOnBy.map((d) => ({ id: d.id, note: d.note, source: { id: d.source.id, title: d.source.title, retired: d.source.status === "retired" } }))}
          impact={impact.map((i) => ({ id: i.id, title: i.title, status: i.status, depth: i.depth }))}
          contentOptions={allContent
            .filter((c) => !dependsOn.some((d) => d.target?.id === c.id))
            .map((c) => ({ id: c.id, label: c.title, hint: c.status === "retired" ? "Retired" : undefined }))}
          sourceSuggestions={sources.map((x) => x.name)}
        />
      </ContentDetail>
    </PageContainer>
  );
}
