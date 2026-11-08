"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { getContentItemForUser, getDeliverableForUser } from "@/lib/authz";
import { addMonths, CONTENT_STATUSES, CONTENT_TYPES, REVIEW_INTERVALS, type ContentType } from "@/lib/content";
import { Role } from "@/generated/prisma/client";
import { impactOf, normalizeSource, type Origin } from "@/lib/content-impact";
import { notificationsEnabled } from "@/lib/notify";
import { enqueueEmail } from "@/lib/queues";
import { appUrl } from "@/lib/app-url";
import { contentNeedsReviewAfterChange, withLink } from "@/lib/email-templates";

// The content inventory (docs/CONTENT-LIFECYCLE-REUSE.md, phases 0–1). Any member can
// add and edit items — it's a shared record of what the team has shipped; deleting
// one is for admins and managers, since retiring keeps the history and is the normal
// way out.

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-01-31.")
  // 2027-02-30 would otherwise roll over to March 2.
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, "That isn't a real date.")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

// Only web links: the URL is rendered as a link, so `javascript:` and friends stay out.
const url = z
  .string()
  .trim()
  .max(2000)
  .refine((s) => /^https?:\/\/[^\s]+$/i.test(s), "Use a full web address starting with https://.");

const Fields = z.object({
  title: z.string().trim().min(1, "Give it a title.").max(200),
  description: z.string().trim().max(5000).nullable(),
  contentType: z.enum(CONTENT_TYPES),
  status: z.enum(CONTENT_STATUSES),
  ownerId: z.string().min(1).nullable(),
  externalUrl: url.nullable(),
  publishedAt: day.nullable(),
  reviewDate: day.nullable(),
  reviewIntervalMonths: z
    .number()
    .int()
    .refine((n) => (REVIEW_INTERVALS as readonly number[]).includes(n), "Pick one of the review cadences.")
    .nullable(),
  expiryDate: day.nullable(),
});

export type ContentFields = z.input<typeof Fields>;

const emptyToNull = (input: Partial<ContentFields>) =>
  Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === "" ? null : v])) as Partial<ContentFields>;

function firstError(e: z.ZodError) {
  return e.issues[0]?.message ?? "Check the details and try again.";
}

function touched(id?: string) {
  revalidatePath("/content");
  if (id) revalidatePath(`/content/${id}`);
  revalidatePath("/my-work");
  revalidatePath("/dashboard");
}

/** The owner must be an active member of the item's workspace. */
async function ownerOk(ownerId: string | null | undefined, workspaceId: string) {
  if (!ownerId) return true;
  return !!(await prisma.membership.findFirst({ where: { userId: ownerId, workspaceId, suspendedAt: null }, select: { id: true } }));
}

export async function createContentItem(input: Partial<ContentFields> & { title: string }) {
  const membership = await getActiveMembership();
  if (!membership) return { error: "Not signed in." };
  const parsed = Fields.partial().required({ title: true }).safeParse(emptyToNull(input));
  if (!parsed.success) return { error: firstError(parsed.error) };
  if (!(await ownerOk(parsed.data.ownerId, membership.workspaceId))) return { error: "The owner must be a member of this workspace." };
  const item = await prisma.contentItem.create({
    data: { ...parsed.data, workspaceId: membership.workspaceId, createdById: membership.userId },
    select: { id: true },
  });
  touched(item.id);
  return { id: item.id };
}

export async function updateContentItem(id: string, patch: Partial<ContentFields>) {
  const item = await getContentItemForUser(id);
  if (!item) return { error: "Content not found." };
  const parsed = Fields.partial().safeParse(emptyToNull(patch));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const data = parsed.data;
  if (!(await ownerOk(data.ownerId, item.workspaceId))) return { error: "The owner must be a member of this workspace." };
  const sameDay = (a: Date | null | undefined, b: Date | null) => (a ?? null)?.getTime() === b?.getTime();
  await prisma.contentItem.update({
    where: { id },
    data: {
      ...data,
      // A moved date starts its reminders over.
      ...(data.reviewDate !== undefined && !sameDay(data.reviewDate, item.reviewDate) ? { reviewRemindedStage: null } : {}),
      ...(data.expiryDate !== undefined && !sameDay(data.expiryDate, item.expiryDate) ? { expiryRemindedStage: null } : {}),
      // Moving off "needs review" settles whatever flagged it.
      ...(data.status && data.status !== "needs_review" && item.status === "needs_review" ? { needsReviewReason: null, needsReviewAt: null } : {}),
    },
  });
  touched(id);
  return { ok: true as const };
}

/** Replace the item's labels with these (workspace labels only). */
export async function setContentLabels(id: string, labelIds: string[]) {
  const item = await getContentItemForUser(id);
  if (!item) return { error: "Content not found." };
  const ids = [...new Set(labelIds)].slice(0, 50);
  const valid = await prisma.label.findMany({ where: { id: { in: ids }, workspaceId: item.workspaceId }, select: { id: true } });
  await prisma.$transaction([
    prisma.contentItemLabel.deleteMany({ where: { contentItemId: id } }),
    prisma.contentItemLabel.createMany({ data: valid.map((l) => ({ contentItemId: id, labelId: l.id })) }),
  ]);
  touched(id);
  return { ok: true as const };
}

/** Someone looked it over and it's still right: record that, and schedule the next
 *  review one cadence from today (12 months when no cadence is set). */
export async function markContentReviewed(id: string) {
  const item = await getContentItemForUser(id);
  if (!item) return { error: "Content not found." };
  if (item.status === "retired") return { error: "Retired content isn't reviewed. Restore it first." };
  const now = new Date();
  const next = addMonths(now, item.reviewIntervalMonths ?? 12);
  await prisma.contentItem.update({
    where: { id },
    data: {
      lastReviewedAt: now,
      reviewDate: next,
      reviewRemindedStage: null,
      needsReviewReason: null,
      needsReviewAt: null,
      ...(item.status === "needs_review" ? { status: "published" } : {}),
    },
  });
  touched(id);
  return { ok: true as const, reviewDate: next.toISOString() };
}

export async function deleteContentItem(id: string) {
  const item = await getContentItemForUser(id);
  if (!item) return { error: "Content not found." };
  const membership = await getActiveMembership();
  if (!membership || membership.workspaceId !== item.workspaceId || (membership.role !== Role.ADMIN && membership.role !== Role.MANAGER)) {
    return { error: "Only admins and managers can delete content. Retire it instead to hide it." };
  }
  await prisma.contentItem.delete({ where: { id } });
  touched();
  return { ok: true as const };
}

const FROM_DELIVERABLE: Record<string, ContentType> = {
  storyboard: "course",
  assessment: "assessment",
  job_aid: "job_aid",
  video: "video",
  document: "document",
};

/** "Track this deliverable": add it to the inventory, prefilled from the deliverable and
 *  its project. A deliverable already tracked returns its existing item. */
export async function trackDeliverable(deliverableId: string) {
  const d = await getDeliverableForUser(deliverableId);
  if (!d) return { error: "Deliverable not found." };
  const existing = await prisma.contentItem.findFirst({ where: { deliverableId }, select: { id: true } });
  if (existing) return { id: existing.id, existing: true };
  const membership = await getActiveMembership();
  const deliverable = await prisma.deliverable.findUniqueOrThrow({
    where: { id: deliverableId },
    select: { name: true, type: true, project: { select: { id: true, name: true, workspaceId: true } } },
  });
  if (!membership || membership.workspaceId !== deliverable.project.workspaceId) return { error: "Switch to this project's workspace first." };
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const item = await prisma.contentItem.create({
    data: {
      workspaceId: deliverable.project.workspaceId,
      title: deliverable.name,
      contentType: FROM_DELIVERABLE[deliverable.type] ?? "other",
      status: "published",
      publishedAt: today,
      ownerId: membership.userId,
      deliverableId,
      projectId: deliverable.project.id,
      createdById: membership.userId,
    },
    select: { id: true },
  });
  touched(item.id);
  revalidatePath(`/projects/${deliverable.project.id}`);
  return { id: item.id, existing: false };
}

// ── Dependencies and impact (phase 5) ─────────────────────────────────────────

const SourceName = z.string().trim().min(2, "Name what it depends on.").max(200);

/** Record that a content item depends on another item, or on an outside source. */
export async function addContentDependency(contentId: string, on: { targetId: string } | { externalSource: string }, note?: string | null) {
  const item = await getContentItemForUser(contentId);
  const membership = await getActiveMembership();
  if (!item || !membership || item.workspaceId !== membership.workspaceId) return { error: "Content not found." };
  const n = z.string().trim().max(500).nullable().optional().safeParse(note ?? null);
  if (!n.success) return { error: "Keep the note under 500 characters." };
  let data: { targetId: string } | { externalSource: string };
  if ("targetId" in on) {
    if (on.targetId === contentId) return { error: "An item can't depend on itself." };
    const target = await getContentItemForUser(on.targetId);
    if (!target || target.workspaceId !== item.workspaceId) return { error: "That content isn't in this workspace." };
    if (await prisma.contentDependency.findFirst({ where: { sourceId: contentId, targetId: on.targetId }, select: { id: true } })) {
      return { error: "It already depends on that." };
    }
    data = { targetId: on.targetId };
  } else {
    const name = SourceName.safeParse(on.externalSource);
    if (!name.success) return { error: firstError(name.error) };
    const clean = normalizeSource(name.data);
    if (await prisma.contentDependency.findFirst({ where: { sourceId: contentId, externalSource: { equals: clean, mode: "insensitive" } }, select: { id: true } })) {
      return { error: "It already depends on that." };
    }
    data = { externalSource: clean };
  }
  const dep = await prisma.contentDependency.create({
    data: { ...data, sourceId: contentId, workspaceId: item.workspaceId, note: n.data || null, createdById: membership.userId },
    select: { id: true },
  });
  touched(contentId);
  if ("targetId" in data) revalidatePath(`/content/${data.targetId}`);
  revalidatePath("/content/sources");
  return { id: dep.id };
}

export async function removeContentDependency(dependencyId: string) {
  const membership = await getActiveMembership();
  if (!membership) return { error: "Not signed in." };
  const dep = await prisma.contentDependency.findFirst({ where: { id: dependencyId, workspaceId: membership.workspaceId }, select: { sourceId: true, targetId: true } });
  if (!dep || !(await getContentItemForUser(dep.sourceId))) return { error: "Dependency not found." };
  await prisma.contentDependency.delete({ where: { id: dependencyId } });
  touched(dep.sourceId);
  if (dep.targetId) revalidatePath(`/content/${dep.targetId}`);
  revalidatePath("/content/sources");
  return { ok: true as const };
}

/** "This changed": flag everything that depends on it (directly or through other content)
 *  for review, record why, and email the owners. Published items move to Needs review;
 *  drafts keep their status but get the reason. Retired items are left alone. */
export async function flagContentChange(origin: Origin, note?: string | null) {
  const membership = await getActiveMembership();
  if (!membership) return { error: "Not signed in." };
  let changed: string;
  if ("contentId" in origin) {
    const o = await getContentItemForUser(origin.contentId);
    if (!o || o.workspaceId !== membership.workspaceId) return { error: "Content not found." };
    changed = (await prisma.contentItem.findUniqueOrThrow({ where: { id: origin.contentId }, select: { title: true } })).title;
  } else {
    const name = SourceName.safeParse(origin.externalSource);
    if (!name.success) return { error: firstError(name.error) };
    changed = normalizeSource(name.data);
  }
  const n = z.string().trim().max(1000).nullable().optional().safeParse(note ?? null);
  if (!n.success) return { error: "Keep the note under 1,000 characters." };
  const cleanNote = n.data || null;

  const impacted = await impactOf(membership.workspaceId, "contentId" in origin ? origin : { externalSource: changed });
  if (!impacted.length) return { flagged: [], drafts: 0 };
  const now = new Date();
  const reason = (via: string) => (via === changed ? `${changed} changed` : `${via} depends on ${changed}, which changed`).slice(0, 300) + (cleanNote ? `: ${cleanNote}`.slice(0, 500) : "");
  const live = impacted.filter((i) => i.status !== "draft");
  const drafts = impacted.filter((i) => i.status === "draft");
  await prisma.$transaction([
    ...live.map((i) => prisma.contentItem.update({ where: { id: i.id }, data: { status: "needs_review", needsReviewReason: reason(i.via), needsReviewAt: now } })),
    ...drafts.map((i) => prisma.contentItem.update({ where: { id: i.id }, data: { needsReviewReason: reason(i.via), needsReviewAt: now } })),
  ]);

  // Mail the owners of live items (or the workspace's admins and managers for unowned ones).
  if (live.length && (await notificationsEnabled(membership.workspaceId, "lifecycle"))) {
    const flaggedBy = (await prisma.user.findUnique({ where: { id: membership.userId }, select: { name: true, email: true } }))!;
    const active = new Set(
      (await prisma.membership.findMany({ where: { workspaceId: membership.workspaceId, suspendedAt: null }, select: { userId: true } })).map((m) => m.userId),
    );
    const managers = await prisma.user.findMany({
      where: { memberships: { some: { workspaceId: membership.workspaceId, role: { in: ["ADMIN", "MANAGER"] }, suspendedAt: null } } },
      select: { id: true, name: true, email: true },
    });
    for (const i of live) {
      const to = i.owner && active.has(i.owner.id) ? [i.owner] : managers;
      for (const r of to) {
        if (r.id === membership.userId) continue; // they just did it
        await enqueueEmail({
          to: r.email,
          ...withLink(
            contentNeedsReviewAfterChange({ recipientName: r.name ?? r.email, title: i.title, changed, note: cleanNote, flaggedBy: flaggedBy.name ?? flaggedBy.email }),
            appUrl(`/content/${i.id}`),
          ),
        });
      }
    }
  }
  for (const i of impacted) revalidatePath(`/content/${i.id}`);
  touched();
  return { flagged: live.map((i) => ({ id: i.id, title: i.title, via: i.via })), drafts: drafts.length };
}
