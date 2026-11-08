import "server-only";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";

// S3-compatible object storage (MinIO). Every byte goes THROUGH the app, on the app's
// own HTTPS origin: MinIO's endpoint isn't reachable over the public tunnel, and is
// plain HTTP on the LAN (mixed content). S3_ENDPOINT is the host the app uses
// (http://minio:9000 under Compose).

const BUCKET = process.env.S3_BUCKET ?? "tavoro";
const REGION = process.env.S3_REGION ?? "us-east-1";
const ACCESS = process.env.S3_ACCESS_KEY ?? "";
const SECRET = process.env.S3_SECRET_KEY ?? "";
const INTERNAL_ENDPOINT = process.env.S3_ENDPOINT ?? "http://localhost:9000";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

function makeClient(endpoint: string) {
  return new S3Client({
    region: REGION,
    endpoint,
    forcePathStyle: true, // MinIO needs path-style addressing
    credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
  });
}

const serverClient = makeClient(INTERNAL_ENDPOINT);

let bucketReady: Promise<void> | null = null;
function ensureBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      try {
        await serverClient.send(new HeadBucketCommand({ Bucket: BUCKET }));
      } catch {
        try {
          await serverClient.send(new CreateBucketCommand({ Bucket: BUCKET }));
        } catch {
          // racing creators / already exists — ignore
        }
      }
    })();
  }
  return bucketReady;
}

export function buildObjectKey(workspaceId: string, cardId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
  return `workspace/${workspaceId}/card/${cardId}/${crypto.randomUUID()}-${safe}`;
}

/** Object keys for files under review: workspace/{id}/review/{deliverableId}/{uuid}-{name}. */
export function buildReviewObjectKey(workspaceId: string, deliverableId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
  return `workspace/${workspaceId}/review/${deliverableId}/${crypto.randomUUID()}-${safe}`;
}

/** Object keys for library assets: workspace/{id}/asset/{assetId}/{uuid}-{name}. A
 *  replaced file gets a new key, so a cached copy of the old one can't be served. */
export function buildAssetObjectKey(workspaceId: string, assetId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
  return `workspace/${workspaceId}/asset/${assetId}/${crypto.randomUUID()}-${safe}`;
}

/** Stream a request body to storage as a multipart upload — never buffered whole in
 *  memory, so it scales to the large files phase-3 review (and later video) needs. */
export async function putObjectStream(key: string, body: ReadableStream<Uint8Array>, contentType: string): Promise<void> {
  await ensureBucket();
  await new Upload({
    client: serverClient,
    params: { Bucket: BUCKET, Key: key, Body: Readable.fromWeb(body as never), ContentType: contentType },
    queueSize: 2,
    partSize: 8 * 1024 * 1024,
  }).done();
}

/** Stream an object, optionally a byte range ("bytes=0-1023"). Null if absent. */
export async function getObjectStream(
  key: string,
  range?: string | null,
): Promise<{ body: ReadableStream; contentLength: number; contentRange: string | null } | null> {
  try {
    const res = await serverClient.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: range ?? undefined }));
    if (!res.Body) return null;
    return {
      body: res.Body.transformToWebStream(),
      contentLength: res.ContentLength ?? 0,
      contentRange: res.ContentRange ?? null,
    };
  } catch (e) {
    // A Range past the end is the caller's error, not a missing object.
    if ((e as { name?: string }).name === "InvalidRange") throw e;
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await serverClient.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    // best-effort; the DB record is the source of truth
  }
}

/** Read an object's bytes server-side (used by workspace backup). Null if absent. */
export async function getObjectBytes(key: string): Promise<Uint8Array | null> {
  try {
    const res = await serverClient.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    return bytes ?? null;
  } catch {
    return null;
  }
}

/** Write an object's bytes server-side (used by workspace restore). */
export async function putObjectBytes(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await ensureBucket();
  await serverClient.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes, ContentType: contentType }),
  );
}

// ── Multipart uploads (files over Cloudflare's 100 MB request cap) ─────────────
// The browser sends the file in parts, one request each; the app passes every part
// straight to the object store's own multipart upload and completes it at the end.

export async function startMultipart(key: string, contentType: string): Promise<string> {
  await ensureBucket();
  const res = await serverClient.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }));
  if (!res.UploadId) throw new Error("no upload id");
  return res.UploadId;
}

export async function uploadPart(key: string, uploadId: string, partNumber: number, body: Uint8Array): Promise<string> {
  const res = await serverClient.send(
    new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body, ContentLength: body.byteLength }),
  );
  if (!res.ETag) throw new Error("no etag");
  return res.ETag;
}

export async function completeMultipart(key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[]): Promise<void> {
  await serverClient.send(
    new CompleteMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts } }),
  );
}

export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  try {
    await serverClient.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }));
  } catch {
    // already completed or gone
  }
}

/** An object's size in bytes, or null if it's absent. */
export async function objectSize(key: string): Promise<number | null> {
  try {
    const res = await serverClient.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return res.ContentLength ?? null;
  } catch {
    return null;
  }
}
