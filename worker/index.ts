import "dotenv/config";
import { Worker, Queue, type ConnectionOptions } from "bullmq";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { sendMail } from "../src/lib/mailer";
import { enqueueEmail } from "../src/lib/queues";
import { runDueReminders, runLifecycleReminders } from "../src/lib/reminders";
import { sweepReviewFiles } from "../src/lib/review-file-sweep";
import { sweepOAuth } from "../src/lib/oauth-sweep";
import { S3Client } from "@aws-sdk/client-s3";

// Background job runner. Phase 5 registers real LearnUpon sync jobs here; for
// now it stays alive and confirms the app ⇄ Redis ⇄ worker topology works.

// Let BullMQ own its Redis connections (avoids passing a shared ioredis instance,
// which trips a structural type mismatch between bullmq's and our ioredis types).
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection: ConnectionOptions = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
};

export const lmsQueue = new Queue("lms-sync", { connection });

const worker = new Worker(
  "lms-sync",
  async (job) => {
    console.log(`[worker] processing job ${job.id} (${job.name})`);
    return { ok: true };
  },
  { connection },
);

worker.on("ready", () => console.log("[worker] ready — listening on queue 'lms-sync'"));
worker.on("failed", (job, err) => console.error(`[worker] job ${job?.id} failed:`, err));

// Intake notifications (new request -> admins, approved/rejected -> requester) —
// see src/lib/queues.ts for the producer side that enqueues these.
const emailWorker = new Worker(
  "email",
  async (job) => {
    // A member the identity provider has deactivated everywhere gets no more mail
    // (docs/SSO.md). Guests and requesters aren't members, so they're unaffected.
    const to = String(job.data?.to ?? "").toLowerCase();
    const user = to ? await prisma.user.findUnique({ where: { email: to }, select: { memberships: { select: { suspendedAt: true } } } }) : null;
    if (user?.memberships.length && user.memberships.every((m) => m.suspendedAt)) return;
    await sendMail(job.data);
    return { ok: true };
  },
  { connection },
);

emailWorker.on("ready", () => console.log("[worker] ready — listening on queue 'email'"));
emailWorker.on("failed", (job, err) => console.error(`[worker] email job ${job?.id} failed:`, err));

// Daily due-date & milestone reminders. The worker owns its own Prisma client
// (src/lib/db.ts is server-only, so it can't be imported here).
const prismaAdapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
const prisma = new PrismaClient({ adapter: prismaAdapter });
const remindersQueue = new Queue("reminders", { connection });

// Repeatable at 13:00 UTC (~morning in the Americas). Re-adding on each start is
// idempotent — BullMQ upserts by the repeat key (name + pattern).
remindersQueue
  .add("daily", {}, { repeat: { pattern: "0 13 * * *" }, removeOnComplete: true, removeOnFail: 50 })
  .then(() => console.log("[worker] scheduled daily reminders (13:00 UTC)"))
  .catch((err) => console.error("[worker] failed to schedule reminders:", err));

const remindersWorker = new Worker(
  "reminders",
  async () => {
    const n = await runDueReminders(prisma, enqueueEmail);
    const c = await runLifecycleReminders(prisma, enqueueEmail);
    console.log(`[worker] reminders: enqueued ${n} due-date + ${c} content lifecycle email(s)`);
    return { ok: true, enqueued: n + c };
  },
  { connection },
);
remindersWorker.on("failed", (job, err) => console.error(`[worker] reminders job ${job?.id} failed:`, err));

// Nightly storage clean-up: review files that were uploaded but never used, and bytes
// left behind when deliverables/projects/workspaces were deleted (src/lib/review-file-sweep.ts).
const s3 = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? "", secretAccessKey: process.env.S3_SECRET_KEY ?? "" },
});
const maintenanceQueue = new Queue("maintenance", { connection });
maintenanceQueue
  .add("sweep-review-files", {}, { repeat: { pattern: "30 4 * * *" }, removeOnComplete: true, removeOnFail: 50 })
  .then(() => console.log("[worker] scheduled nightly review-file sweep (04:30 UTC)"))
  .catch((err) => console.error("[worker] failed to schedule the review-file sweep:", err));

const maintenanceWorker = new Worker(
  "maintenance",
  async () => {
    const r = await sweepReviewFiles(prisma, s3, process.env.S3_BUCKET ?? "tavoro");
    console.log(`[worker] file sweep: ${r.unusedFiles} unused review upload(s), ${r.orphanedObjects} orphaned review object(s), ${r.orphanedAssets} orphaned asset file(s) removed, ${r.abandonedUploads} abandoned part upload(s) aborted`);
    const o = await sweepOAuth(prisma);
    console.log(`[worker] MCP credential sweep: ${o.codes} code(s), ${o.tokens} token(s), ${o.clients} unused client(s) removed`);
    return { ...r, oauth: o };
  },
  { connection },
);
maintenanceWorker.on("failed", (job, err) => console.error(`[worker] maintenance job ${job?.id} failed:`, err));

console.log("[worker] starting…");

async function shutdown() {
  console.log("[worker] shutting down…");
  await worker.close();
  await emailWorker.close();
  await remindersWorker.close();
  await maintenanceWorker.close();
  await lmsQueue.close();
  await remindersQueue.close();
  await maintenanceQueue.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
