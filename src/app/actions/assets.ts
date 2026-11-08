"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { getAssetForUser, getContentItemForUser } from "@/lib/authz";
import { deleteObject } from "@/lib/storage";
import { ASSET_TYPES } from "@/lib/asset-types";
import { Role } from "@/generated/prisma/client";

// The asset library (docs/CONTENT-LIFECYCLE-REUSE.md, phase 2). Any member can add,
// edit, label, archive and attach assets — it's the team's shared shelf. Deleting one
// is for whoever uploaded it, or an admin or manager; archiving is the normal way out.
// Files are uploaded through PUT /api/assets (streamed), not here.

// Only web links: the URL is rendered as a link, so `javascript:` and friends stay out.
const url = z
  .string()
  .trim()
  .max(2000)
  .refine((s) => /^https?:\/\/[^\s]+$/i.test(s), "Use a full web address starting with https://.");

const Fields = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(200),
  description: z.string().trim().max(5000).nullable(),
  assetType: z.enum(ASSET_TYPES),
  externalUrl: url.nullable(),
});

export type AssetFields = z.input<typeof Fields>;

const emptyToNull = (input: Partial<AssetFields>) =>
  Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === "" ? null : v])) as Partial<AssetFields>;

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Check the details and try again.";

function touched(id?: string, contentIds: string[] = []) {
  revalidatePath("/assets");
  if (id) revalidatePath(`/assets/${id}`);
  for (const c of contentIds) revalidatePath(`/content/${c}`);
}

/** The asset, if it's in the active workspace. */
async function assetHere(id: string) {
  const [asset, membership] = await Promise.all([getAssetForUser(id), getActiveMembership()]);
  if (!asset || !membership || asset.workspaceId !== membership.workspaceId) return null;
  return { asset, membership };
}

/** Add a link to something that lives elsewhere (a Drive folder, a Figma file, a stock
 *  photo page) — the library holds the pointer, not the file. */
export async function createAssetLink(input: Partial<AssetFields> & { name: string; externalUrl: string }) {
  const membership = await getActiveMembership();
  if (!membership) return { error: "Not signed in." };
  const parsed = Fields.partial().required({ name: true, externalUrl: true }).safeParse(emptyToNull(input));
  if (!parsed.success) return { error: firstError(parsed.error) };
  if (!parsed.data.externalUrl) return { error: "Add the link." };
  const asset = await prisma.asset.create({
    data: { ...parsed.data, workspaceId: membership.workspaceId, uploadedById: membership.userId },
    select: { id: true },
  });
  touched(asset.id);
  return { id: asset.id };
}

export async function updateAsset(id: string, patch: Partial<AssetFields>) {
  const here = await assetHere(id);
  if (!here) return { error: "Asset not found." };
  const parsed = Fields.partial().safeParse(emptyToNull(patch));
  if (!parsed.success) return { error: firstError(parsed.error) };
  // An uploaded asset is its file; a link asset is its link. Uploading a file onto a
  // link asset (PUT /api/assets?replace=) is how one becomes the other.
  if (parsed.data.externalUrl !== undefined && here.asset.storageKey) return { error: "This asset is an uploaded file. Replace the file instead." };
  if (parsed.data.externalUrl === null && !here.asset.storageKey) return { error: "A link asset needs its link." };
  await prisma.asset.update({ where: { id }, data: parsed.data });
  touched(id);
  return { ok: true as const };
}

/** Replace the asset's labels with these (workspace labels only). */
export async function setAssetLabels(id: string, labelIds: string[]) {
  const here = await assetHere(id);
  if (!here) return { error: "Asset not found." };
  const ids = [...new Set(labelIds)].slice(0, 50);
  const valid = await prisma.label.findMany({ where: { id: { in: ids }, workspaceId: here.asset.workspaceId }, select: { id: true } });
  await prisma.$transaction([
    prisma.assetLabel.deleteMany({ where: { assetId: id } }),
    prisma.assetLabel.createMany({ data: valid.map((l) => ({ assetId: id, labelId: l.id })) }),
  ]);
  touched(id);
  return { ok: true as const };
}

/** Archived assets leave the library's default view but keep their file and links, so
 *  content that used them still says what it used. */
export async function setAssetArchived(id: string, archived: boolean) {
  const here = await assetHere(id);
  if (!here) return { error: "Asset not found." };
  await prisma.asset.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
  touched(id);
  return { ok: true as const };
}

export async function deleteAsset(id: string) {
  const here = await assetHere(id);
  if (!here) return { error: "Asset not found." };
  const { asset, membership } = here;
  const manager = membership.role === Role.ADMIN || membership.role === Role.MANAGER;
  if (!manager && asset.uploadedById !== membership.userId) {
    return { error: "Only the person who added it, or an admin or manager, can delete an asset. Archive it instead." };
  }
  const uses = await prisma.contentItemAsset.findMany({ where: { assetId: id }, select: { contentItemId: true } });
  await prisma.asset.delete({ where: { id } });
  if (asset.storageKey) await deleteObject(asset.storageKey);
  touched(undefined, uses.map((u) => u.contentItemId));
  return { ok: true as const };
}

/** Record that a content item uses an asset (both in the active workspace). */
export async function attachAsset(contentItemId: string, assetId: string) {
  const [item, here] = await Promise.all([getContentItemForUser(contentItemId), assetHere(assetId)]);
  if (!item || !here || item.workspaceId !== here.asset.workspaceId) return { error: "Content or asset not found." };
  await prisma.contentItemAsset.upsert({
    where: { contentItemId_assetId: { contentItemId, assetId } },
    create: { contentItemId, assetId },
    update: {},
  });
  touched(assetId, [contentItemId]);
  return { ok: true as const };
}

export async function detachAsset(contentItemId: string, assetId: string) {
  const item = await getContentItemForUser(contentItemId);
  if (!item) return { error: "Content not found." };
  await prisma.contentItemAsset.deleteMany({ where: { contentItemId, assetId } });
  touched(assetId, [contentItemId]);
  return { ok: true as const };
}
