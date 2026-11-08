// The asset library's vocabulary (docs/CONTENT-LIFECYCLE-REUSE.md, phase 2). Pure — no
// server-only imports — so client components and the worker can share it.

export const ASSET_TYPES = ["image", "video", "audio", "document", "template_file", "other"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  document: "Document",
  template_file: "Template file",
  other: "Other",
};

/** Under Cloudflare's 100 MB request cap, like review files. */
export const MAX_ASSET_BYTES = 95 * 1024 * 1024;

// Types a browser may show in the page: raster images, PDF, and plain audio/video. They
// are only ever set from the file's own first bytes (see sniffAsset), never from its
// name, so a file can't talk its way into being rendered. Everything else downloads.
export const INLINE_ASSET_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
] as const;

export function isInline(mimeType: string | null | undefined): boolean {
  return !!mimeType && (INLINE_ASSET_TYPES as readonly string[]).includes(mimeType);
}

export function previewKind(mimeType: string | null | undefined): "image" | "video" | "audio" | "pdf" | null {
  if (!isInline(mimeType)) return null;
  if (mimeType!.startsWith("image/")) return "image";
  if (mimeType!.startsWith("video/")) return "video";
  if (mimeType!.startsWith("audio/")) return "audio";
  return "pdf";
}

/** Best guess at an asset's type from what we know about the file; the person can change it. */
export function guessAssetType(mimeType: string | null, fileName: string): AssetType {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("audio/")) return "audio";
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (["svg", "psd", "ai", "eps", "tif", "tiff", "heic", "bmp"].includes(ext)) return "image";
  if (["mov", "avi", "mkv", "m4v", "wmv"].includes(ext)) return "video";
  if (["m4a", "aac", "flac", "aiff"].includes(ext)) return "audio";
  if (["story", "potx", "dotx", "xltx", "rise", "cptx"].includes(ext)) return "template_file";
  if (mimeType === "application/pdf" || ["doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "md", "csv", "rtf", "odt", "key", "pages", "vtt", "srt"].includes(ext)) {
    return "document";
  }
  return "other";
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** The file name without its extension, as a starting name for an uploaded asset. */
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]{1,8}$/, "").replace(/[_]+/g, " ").trim();
  return (base || fileName).slice(0, 200);
}
