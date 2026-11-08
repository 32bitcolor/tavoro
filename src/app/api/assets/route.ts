import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveMembership, getCurrentUser } from "@/lib/dal";
import { getAssetForUser } from "@/lib/authz";
import { buildAssetObjectKey, deleteObject, putObjectStream } from "@/lib/storage";
import { peekStream } from "@/lib/review-files";
import { downloadType, sniffAsset } from "@/lib/assets";
import { guessAssetType, MAX_ASSET_BYTES, nameFromFile } from "@/lib/asset-types";

// Upload a file to the asset library: PUT the raw bytes (not multipart) so they stream
// straight through to storage — ?name=<file name>, plus &replace=<assetId> to swap the
// file behind an existing asset (its links, labels and "used in" stay). Any file type is
// accepted; only types recognised from the file's own first bytes are ever shown inline.
export async function PUT(req: Request) {
  // getActiveMembership redirects when signed out; an API answers 401 instead.
  if (!(await getCurrentUser())) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const membership = await getActiveMembership();
  if (!membership) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(req.url);
  const name = z.string().trim().min(1).max(255).safeParse(url.searchParams.get("name"));
  if (!name.success) return Response.json({ error: "Invalid file name." }, { status: 400 });

  const replaceId = url.searchParams.get("replace");
  const existing = replaceId ? await getAssetForUser(replaceId) : null;
  if (replaceId && (!existing || existing.workspaceId !== membership.workspaceId)) {
    return Response.json({ error: "Asset not found." }, { status: 404 });
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_ASSET_BYTES) return Response.json({ error: "Files can be up to 95 MB." }, { status: 413 });
  if (!req.body) return Response.json({ error: "No file provided." }, { status: 400 });

  const { head, stream, bytes } = await peekStream(req.body, 16, MAX_ASSET_BYTES);
  const sniffed = sniffAsset(head);
  const mimeType = sniffed ?? downloadType(name.data);

  const key = buildAssetObjectKey(membership.workspaceId, existing?.id ?? crypto.randomUUID(), name.data);
  try {
    await putObjectStream(key, stream, mimeType);
  } catch (e) {
    await deleteObject(key);
    const tooLarge = (e as Error).message === "too_large";
    return Response.json({ error: tooLarge ? "Files can be up to 95 MB." : "Upload failed — please try again." }, { status: tooLarge ? 413 : 500 });
  }
  const size = bytes();
  if (size === 0) {
    await deleteObject(key);
    return Response.json({ error: "That file is empty." }, { status: 400 });
  }

  const file = { storageKey: key, fileName: name.data, mimeType, sizeBytes: size };
  let id: string;
  if (existing) {
    await prisma.asset.update({ where: { id: existing.id }, data: { ...file, externalUrl: null } });
    if (existing.storageKey) await deleteObject(existing.storageKey);
    id = existing.id;
  } else {
    const created = await prisma.asset.create({
      data: {
        ...file,
        workspaceId: membership.workspaceId,
        name: nameFromFile(name.data),
        assetType: guessAssetType(sniffed, name.data),
        uploadedById: membership.userId,
      },
      select: { id: true },
    });
    id = created.id;
  }
  revalidatePath("/assets");
  revalidatePath(`/assets/${id}`);
  return Response.json({ asset: { id, ...file, storageKey: undefined } });
}
