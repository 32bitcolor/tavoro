"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { getContentItemForUser, getDeliverableForUser } from "@/lib/authz";
import { addMonths, CONTENT_STATUSES, CONTENT_TYPES, REVIEW_INTERVALS, type ContentType } from "@/lib/content";
import { Role } from "@/generated/prisma/client";

// The content inventory (docs/CONTENT-LIFECYCLE-REUSE.md, phases 0–1). Any member can
// add and edit items — it's a shared record of what the team has shipped; deleting
// one is for admins and managers, since retiring keeps the history and is the normal
// way out.

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-01-31.")
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "That isn't a real date.");

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
