import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/dal";
import { getCardForUser } from "@/lib/authz";
import { getObjectBytes } from "@/lib/storage";
import { contentDisposition } from "@/lib/content-disposition";

// Streams the file back through the app (same HTTPS origin) instead of handing
// out a presigned MinIO URL the browser may not be able to reach. Access is
// gated by the same group-based card access as the rest of the board.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const att = await prisma.attachment.findUnique({
    where: { id },
    select: { storageKey: true, fileName: true, mimeType: true, cardId: true },
  });
  if (!att || !(await getCardForUser(att.cardId))) return new Response("Not found", { status: 404 });

  const bytes = await getObjectBytes(att.storageKey);
  if (!bytes) return new Response("Not found", { status: 404 });

  // Uint8Array is a valid response body at runtime; the cast sidesteps the
  // ArrayBufferLike/BodyInit generic friction in the DOM lib types.
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": att.mimeType || "application/octet-stream",
      "Content-Disposition": contentDisposition(att.fileName),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Content-Length": String(bytes.byteLength),
    },
  });
}
