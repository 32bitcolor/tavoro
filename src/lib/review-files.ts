import "server-only";
import { getObjectStream } from "@/lib/storage";
import { contentDisposition } from "@/lib/content-disposition";

// Files under review (docs/REVIEW-LINKS.md, phase 3). Tavoro reviews what it can
// render WITHOUT executing it: PDFs (rendered by pdf.js into a canvas) and raster
// images. No SVG (it can carry script), no HTML, no SCORM — ever.

export const MAX_REVIEW_FILE_BYTES = 95 * 1024 * 1024; // under Cloudflare's 100 MB body cap

export const REVIEW_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ReviewFileType = (typeof REVIEW_FILE_TYPES)[number];

/** Identify a file by its first bytes, never by its name or the browser's claim. */
export function sniffReviewFileType(head: Uint8Array): ReviewFileType | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  const ascii = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  if (ascii(0, "%PDF-")) return "application/pdf";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

/** Peek at the first `n` bytes of a stream without losing them: returns the head and a
 *  stream that replays it followed by the rest — counting bytes, and erroring past `max`. */
export async function peekStream(
  body: ReadableStream<Uint8Array>,
  n: number,
  max: number,
): Promise<{ head: Uint8Array; stream: ReadableStream<Uint8Array>; bytes: () => number }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let have = 0;
  while (have < n) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    have += value.byteLength;
  }
  const first = new Uint8Array(have);
  let off = 0;
  for (const c of chunks) {
    first.set(c, off);
    off += c.byteLength;
  }
  let total = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      total += first.byteLength;
      if (first.byteLength) controller.enqueue(first);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        return controller.error(new Error("too_large"));
      }
      controller.enqueue(value);
    },
    cancel() {
      return reader.cancel();
    },
  });
  return { head: first.subarray(0, n), stream, bytes: () => total };
}

/** Respond with a review file, honouring HTTP Range (pdf.js reads PDFs in ranges, and
 *  video will need it to seek). The headers stop a browser from ever running the file. */
export async function serveReviewFile(
  req: Request,
  file: { storageKey: string; fileName: string; mimeType: string; sizeBytes: number },
): Promise<Response> {
  const range = req.headers.get("range");
  const wantsRange = range && /^bytes=\d*-\d*$/.test(range) ? range : null;
  const download = new URL(req.url).searchParams.has("download");
  const headers: Record<string, string> = {
    "Content-Type": (REVIEW_FILE_TYPES as readonly string[]).includes(file.mimeType) ? file.mimeType : "application/octet-stream",
    "Content-Disposition": contentDisposition(file.fileName, download ? "attachment" : "inline"),
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    // Review files never change (a new version is a new upload), but they're private.
    "Cache-Control": "private, max-age=3600",
    "Referrer-Policy": "no-referrer",
  };

  let obj;
  try {
    obj = await getObjectStream(file.storageKey, wantsRange);
  } catch {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.sizeBytes}` } });
  }
  if (!obj) return new Response("Not found", { status: 404 });
  headers["Content-Length"] = String(obj.contentLength);
  if (wantsRange && obj.contentRange) {
    headers["Content-Range"] = obj.contentRange;
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}
