import { getAssetForUser } from "@/lib/authz";
import { serveAsset } from "@/lib/assets";

// An asset's file, for members of its workspace. ?download forces a download.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAssetForUser(id);
  if (!asset?.storageKey || !asset.fileName || !asset.mimeType || asset.sizeBytes == null) {
    return new Response("Not found", { status: 404 });
  }
  return serveAsset(req, { storageKey: asset.storageKey, fileName: asset.fileName, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes });
}
