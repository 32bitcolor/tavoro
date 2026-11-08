import { FileArchive, FileAudio, FileImage, FileText, FileVideo, LayoutTemplate, Link2 } from "lucide-react";
import { previewKind } from "@/lib/asset-types";
import { cn } from "@/lib/utils";

const ICON = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  template_file: LayoutTemplate,
  other: FileArchive,
} as const;

/** A square preview: the picture itself for images, otherwise an icon for its type. */
export function AssetThumb({
  asset,
  className,
}: {
  asset: { name: string; assetType: string; mimeType: string | null; fileUrl: string | null; externalUrl: string | null };
  className?: string;
}) {
  if (asset.fileUrl && previewKind(asset.mimeType) === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- served by our own route, private and ranged
      <img src={asset.fileUrl} alt="" loading="lazy" className={cn("size-full object-cover", className)} />
    );
  }
  const Icon = !asset.fileUrl && asset.externalUrl ? Link2 : (ICON[asset.assetType as keyof typeof ICON] ?? FileArchive);
  return (
    <span className={cn("flex size-full items-center justify-center bg-muted text-muted-foreground", className)}>
      <Icon className="size-8" aria-hidden="true" />
    </span>
  );
}
