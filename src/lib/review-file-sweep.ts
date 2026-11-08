import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient } from "../generated/prisma/client";

// Nightly clean-up of review files nobody will ever look at (run by the worker, so no
// "server-only" imports; the Prisma and S3 clients are passed in).
//
// 1. Unused uploads: a designer uploads a file in the start-round form, then closes the
//    tab instead of starting the round or cancelling. The ReviewFile row and its bytes
//    are left with no round.
// 2. Orphaned bytes: deleting a deliverable, project or workspace cascades the
//    ReviewFile rows away in the database, but storage doesn't cascade.
//
// 3. Orphaned asset files: the same for the asset library (workspace/{id}/asset/…) —
//    deleting a workspace cascades its Asset rows, and an upload whose row was never
//    written leaves bytes behind. Replacing or deleting an asset removes its old file
//    straight away, so this only catches what slipped through.
//
// All wait out a grace period, so an upload that's still in progress (or a round
// that's about to be started from it) is never touched.

const GRACE_MS = 24 * 60 * 60 * 1000;
const REVIEW_KEY = /^workspace\/[^/]+\/review\//;
const ASSET_KEY = /^workspace\/[^/]+\/asset\//;

export async function sweepReviewFiles(
  prisma: PrismaClient,
  s3: S3Client,
  bucket: string,
  now = new Date(),
): Promise<{ unusedFiles: number; orphanedObjects: number; orphanedAssets: number }> {
  const cutoff = new Date(now.getTime() - GRACE_MS);

  // 1. Rows with no round, older than the grace period: drop the row, then its bytes.
  const unused = await prisma.reviewFile.findMany({
    where: { rounds: { none: {} }, createdAt: { lt: cutoff } },
    select: { id: true, storageKey: true },
  });
  if (unused.length) {
    await prisma.reviewFile.deleteMany({ where: { id: { in: unused.map((f) => f.id) } } });
    await deleteKeys(s3, bucket, unused.map((f) => f.storageKey));
  }

  // 2 + 3. Review-file and asset objects with no row at all.
  const stale: string[] = [];
  const staleAssets: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "workspace/", ContinuationToken: token }));
    for (const o of page.Contents ?? []) {
      if (!o.Key || !o.LastModified || o.LastModified >= cutoff) continue;
      if (REVIEW_KEY.test(o.Key)) stale.push(o.Key);
      else if (ASSET_KEY.test(o.Key)) staleAssets.push(o.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  const orphans: string[] = [];
  for (let i = 0; i < stale.length; i += 1000) {
    const batch = stale.slice(i, i + 1000);
    const known = await prisma.reviewFile.findMany({ where: { storageKey: { in: batch } }, select: { storageKey: true } });
    const have = new Set(known.map((k) => k.storageKey));
    orphans.push(...batch.filter((k) => !have.has(k)));
  }
  await deleteKeys(s3, bucket, orphans);

  const assetOrphans: string[] = [];
  for (let i = 0; i < staleAssets.length; i += 1000) {
    const batch = staleAssets.slice(i, i + 1000);
    const known = await prisma.asset.findMany({ where: { storageKey: { in: batch } }, select: { storageKey: true } });
    const have = new Set(known.map((k) => k.storageKey));
    assetOrphans.push(...batch.filter((k) => !have.has(k)));
  }
  await deleteKeys(s3, bucket, assetOrphans);

  return { unusedFiles: unused.length, orphanedObjects: orphans.length, orphanedAssets: assetOrphans.length };
}

async function deleteKeys(s3: S3Client, bucket: string, keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
  }
}
