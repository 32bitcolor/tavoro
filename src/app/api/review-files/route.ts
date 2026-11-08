import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/dal";
import { getDeliverableForUser } from "@/lib/authz";
import { buildReviewObjectKey, deleteObject, putObjectStream } from "@/lib/storage";
import { MAX_REVIEW_FILE_BYTES, peekStream, sniffReviewFileType } from "@/lib/review-files";

// Upload a file to review: PUT the raw bytes (not multipart) so they stream straight
// through to storage without being buffered — ?deliverableId=…&name=…. The type is
// decided by the file's own first bytes; anything that isn't a PDF or raster image is
// refused. The new ReviewFile is attached to a round by startReviewRound.
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(req.url);
  const deliverable = await getDeliverableForUser(url.searchParams.get("deliverableId") ?? "");
  if (!deliverable) return Response.json({ error: "Deliverable not found." }, { status: 404 });
  const name = z.string().trim().min(1).max(255).safeParse(url.searchParams.get("name"));
  if (!name.success) return Response.json({ error: "Invalid file name." }, { status: 400 });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_REVIEW_FILE_BYTES) {
    return Response.json({ error: "Files can be up to 95 MB." }, { status: 413 });
  }
  if (!req.body) return Response.json({ error: "No file provided." }, { status: 400 });

  const { head, stream, bytes } = await peekStream(req.body, 16, MAX_REVIEW_FILE_BYTES);
  const mimeType = sniffReviewFileType(head);
  if (!mimeType) {
    await stream.cancel();
    return Response.json({ error: "Upload a PDF, a PNG, JPEG, WebP or GIF image, or an MP4 or WebM video." }, { status: 415 });
  }

  const project = await prisma.project.findUnique({ where: { id: deliverable.projectId }, select: { workspaceId: true } });
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  const key = buildReviewObjectKey(project.workspaceId, deliverable.id, name.data);
  try {
    await putObjectStream(key, stream, mimeType);
  } catch (e) {
    await deleteObject(key);
    const tooLarge = (e as Error).message === "too_large";
    return Response.json(
      { error: tooLarge ? "Files can be up to 95 MB." : "Upload failed — please try again." },
      { status: tooLarge ? 413 : 500 },
    );
  }

  const file = await prisma.reviewFile.create({
    data: {
      workspaceId: project.workspaceId,
      deliverableId: deliverable.id,
      fileName: name.data,
      mimeType,
      sizeBytes: bytes(),
      storageKey: key,
      uploadedById: user.id,
    },
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
  });
  return Response.json({ file });
}
