import "server-only";
import { prisma } from "@/lib/db";
import { getObjectStream } from "@/lib/storage";
import { contentDisposition } from "@/lib/content-disposition";
import { isInline } from "@/lib/asset-types";
import type { Prisma } from "@/generated/prisma/client";

// The asset library (docs/CONTENT-LIFECYCLE-REUSE.md, phase 2): reusable files and links,
// workspace-wide like the content inventory (no per-item groups).

/** Identify a file by its first bytes. Only these types are ever shown in the page;
 *  anything else (Office files, zips, SVG, Storyline sources…) is stored as a download. */
export function sniffAsset(head: Uint8Array): string | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  const ascii = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  if (ascii(0, "%PDF-")) return "application/pdf";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "audio/wav";
  if (ascii(0, "OggS")) return "audio/ogg";
  if (ascii(0, "ID3") || at(0, 0xff, 0xfb) || at(0, 0xff, 0xf3) || at(0, 0xff, 0xf2)) return "audio/mpeg";
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
  if (ascii(4, "ftyp")) {
    // ISO media: the brand says what's inside (HEIC/AVIF images share the container).
    if (ascii(8, "M4A ")) return "audio/mp4";
    if (["isom", "iso2", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash", "mmp4"].some((b) => ascii(8, b))) return "video/mp4";
  }
  return null;
}

/** A display type for a file we won't show inline, from its name. Never inline-safe. */
export function downloadType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    zip: "application/zip",
    txt: "text/plain",
    csv: "text/csv",
    md: "text/markdown",
    svg: "image/svg+xml",
    json: "application/json",
    vtt: "text/vtt",
    srt: "application/x-subrip",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Respond with an asset's bytes, honouring Range (video seeks). Only sniffed media types
 *  are served inline; the headers stop a browser from ever running the file. */
export async function serveAsset(
  req: Request,
  file: { storageKey: string; fileName: string; mimeType: string; sizeBytes: number },
): Promise<Response> {
  const range = req.headers.get("range");
  const wantsRange = range && /^bytes=\d*-\d*$/.test(range) ? range : null;
  const inline = isInline(file.mimeType) && !new URL(req.url).searchParams.has("download");
  const headers: Record<string, string> = {
    "Content-Type": isInline(file.mimeType) ? file.mimeType : "application/octet-stream",
    "Content-Disposition": contentDisposition(file.fileName, inline ? "inline" : "attachment"),
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    // Replacing a file gives it a new storage key, and the URL carries ?v=<key hash>,
    // so a private cache is safe.
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

/** The URL an asset's file is served at. `v` changes when the file is replaced. */
export function assetFileUrl(a: { id: string; storageKey: string | null }): string | null {
  if (!a.storageKey) return null;
  const v = a.storageKey.split("/").pop()!.slice(0, 8);
  return `/api/assets/${a.id}?v=${v}`;
}

export const ASSET_SELECT = {
  id: true,
  name: true,
  description: true,
  assetType: true,
  storageKey: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  externalUrl: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: { select: { id: true, name: true, email: true } },
  labels: { select: { label: { select: { id: true, name: true, color: true } } } },
  _count: { select: { contentItems: true } },
} satisfies Prisma.AssetSelect;

type Row = Prisma.AssetGetPayload<{ select: typeof ASSET_SELECT }>;

export type AssetRow = Omit<Row, "labels" | "_count" | "storageKey"> & {
  labels: { id: string; name: string; color: string }[];
  fileUrl: string | null;
  usedIn: number;
};

export function toAssetRow(r: Row): AssetRow {
  const { labels, _count, storageKey, ...rest } = r;
  return { ...rest, labels: labels.map((l) => l.label), fileUrl: assetFileUrl({ id: r.id, storageKey }), usedIn: _count.contentItems };
}

export type AssetFilters = {
  q?: string;
  type?: string;
  labelId?: string;
  archived?: string; // "1" = archived only; default hides archived
  unused?: string; // "1" = not attached to any content
};

export async function listAssets(workspaceId: string, f: AssetFilters = {}): Promise<AssetRow[]> {
  const where: Prisma.AssetWhereInput = {
    workspaceId,
    archivedAt: f.archived === "1" ? { not: null } : null,
    ...(f.q
      ? {
          OR: [
            { name: { contains: f.q, mode: "insensitive" } },
            { description: { contains: f.q, mode: "insensitive" } },
            { fileName: { contains: f.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(f.type ? { assetType: f.type } : {}),
    ...(f.labelId ? { labels: { some: { labelId: f.labelId } } } : {}),
    ...(f.unused === "1" ? { contentItems: { none: {} } } : {}),
  };
  const rows = await prisma.asset.findMany({ where, select: ASSET_SELECT, orderBy: [{ updatedAt: "desc" }], take: 500 });
  return rows.map(toAssetRow);
}
