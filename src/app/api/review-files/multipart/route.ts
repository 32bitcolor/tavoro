import { z } from "zod";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { getCurrentUser } from "@/lib/dal";
import { getDeliverableForUser } from "@/lib/authz";
import {
  abortMultipart,
  buildReviewObjectKey,
  completeMultipart,
  deleteObject,
  getObjectStream,
  objectSize,
  startMultipart,
  uploadPart,
} from "@/lib/storage";
import { MAX_MULTIPART_BYTES, PART_BYTES, sniffReviewFileType } from "@/lib/review-files";

// Large files under review (videos up to 500 MB) in parts, so no single request goes
// over Cloudflare's 100 MB cap: POST ?action=start → PUT ?uploadId&part=n (each part's
// raw bytes) → POST ?action=complete. The type is still decided by the file's own
// first bytes, once it's whole; anything that isn't reviewable is deleted. An upload
// left unfinished expires from Redis after a day, and the nightly sweep aborts it.

type Pending = { userId: string; deliverableId: string; workspaceId: string; key: string; name: string; size: number };
const TTL = 24 * 60 * 60;
const k = (uploadId: string) => `mpu:${uploadId}`;

async function pending(uploadId: string | null, userId: string): Promise<Pending | null> {
  if (!uploadId || uploadId.length > 512) return null;
  const raw = await redis.get(k(uploadId));
  if (!raw) return null;
  const p = JSON.parse(raw) as Pending;
  return p.userId === userId ? p : null;
}

const tooBig = () => Response.json({ error: "Files can be up to 500 MB." }, { status: 413 });

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "start") {
    const deliverable = await getDeliverableForUser(url.searchParams.get("deliverableId") ?? "");
    if (!deliverable) return Response.json({ error: "Deliverable not found." }, { status: 404 });
    const name = z.string().trim().min(1).max(255).safeParse(url.searchParams.get("name"));
    if (!name.success) return Response.json({ error: "Invalid file name." }, { status: 400 });
    const size = Number(url.searchParams.get("size"));
    if (!Number.isInteger(size) || size <= 0) return Response.json({ error: "Invalid file size." }, { status: 400 });
    if (size > MAX_MULTIPART_BYTES) return tooBig();
    const project = await prisma.project.findUnique({ where: { id: deliverable.projectId }, select: { workspaceId: true } });
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const key = buildReviewObjectKey(project.workspaceId, deliverable.id, name.data);
    const uploadId = await startMultipart(key, "application/octet-stream");
    const p: Pending = { userId: user.id, deliverableId: deliverable.id, workspaceId: project.workspaceId, key, name: name.data, size };
    await redis.set(k(uploadId), JSON.stringify(p), "EX", TTL);
    return Response.json({ uploadId, partSize: PART_BYTES, parts: Math.ceil(size / PART_BYTES) });
  }

  if (action === "complete") {
    const uploadId = url.searchParams.get("uploadId");
    const p = await pending(uploadId, user.id);
    if (!p || !uploadId) return Response.json({ error: "Upload not found or expired." }, { status: 404 });
    const etags = await redis.hgetall(`${k(uploadId)}:parts`);
    const expected = Math.ceil(p.size / PART_BYTES);
    const parts = Array.from({ length: expected }, (_, i) => ({ PartNumber: i + 1, ETag: etags[String(i + 1)] }));
    if (parts.some((x) => !x.ETag)) return Response.json({ error: "Some of the file is missing. Please upload it again." }, { status: 400 });
    try {
      await completeMultipart(p.key, uploadId, parts);
    } catch {
      await abortMultipart(p.key, uploadId);
      await redis.del(k(uploadId), `${k(uploadId)}:parts`);
      return Response.json({ error: "Upload failed — please try again." }, { status: 500 });
    }
    await redis.del(k(uploadId), `${k(uploadId)}:parts`);

    const size = await objectSize(p.key);
    const head = await getObjectStream(p.key, "bytes=0-15");
    const bytes = head ? new Uint8Array(await new Response(head.body).arrayBuffer()) : new Uint8Array();
    const mimeType = sniffReviewFileType(bytes);
    if (!mimeType || size == null || size !== p.size || size > MAX_MULTIPART_BYTES) {
      await deleteObject(p.key);
      return mimeType
        ? Response.json({ error: "The upload didn't arrive whole. Please try again." }, { status: 400 })
        : Response.json({ error: "Upload a PDF, a PNG, JPEG, WebP or GIF image, or an MP4 or WebM video." }, { status: 415 });
    }
    const file = await prisma.reviewFile.create({
      data: { workspaceId: p.workspaceId, deliverableId: p.deliverableId, fileName: p.name, mimeType, sizeBytes: size, storageKey: p.key, uploadedById: user.id },
      select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
    });
    return Response.json({ file });
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}

/** One part: PUT ?uploadId=…&part=n with the part's bytes as the body. */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const url = new URL(req.url);
  const uploadId = url.searchParams.get("uploadId");
  const p = await pending(uploadId, user.id);
  if (!p || !uploadId) return Response.json({ error: "Upload not found or expired." }, { status: 404 });
  const part = Number(url.searchParams.get("part"));
  const expected = Math.ceil(p.size / PART_BYTES);
  if (!Number.isInteger(part) || part < 1 || part > expected) return Response.json({ error: "Invalid part." }, { status: 400 });
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > PART_BYTES) return tooBig();
  const body = new Uint8Array(await req.arrayBuffer());
  // Every part is full size except the last.
  const want = part < expected ? PART_BYTES : p.size - PART_BYTES * (expected - 1);
  if (body.byteLength !== want) return Response.json({ error: "That part is the wrong size." }, { status: 400 });
  const etag = await uploadPart(p.key, uploadId, part, body);
  await redis.hset(`${k(uploadId)}:parts`, String(part), etag);
  await redis.expire(`${k(uploadId)}:parts`, TTL);
  return Response.json({ ok: true });
}

/** Give up on an upload (the person cancelled, or a part failed for good). */
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const uploadId = new URL(req.url).searchParams.get("uploadId");
  const p = await pending(uploadId, user.id);
  if (!p || !uploadId) return Response.json({ ok: true });
  await abortMultipart(p.key, uploadId);
  await redis.del(k(uploadId), `${k(uploadId)}:parts`);
  return Response.json({ ok: true });
}
