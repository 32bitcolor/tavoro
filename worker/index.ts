import "dotenv/config";
import { Worker, Queue, type ConnectionOptions } from "bullmq";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { sendMail } from "../src/lib/mailer";
import { enqueueEmail } from "../src/lib/queues";
import { runDueReminders, runLifecycleReminders } from "../src/lib/reminders";
import { sweepReviewFiles } from "../src/lib/review-file-sweep";
import { sweepOAuth } from "../src/lib/oauth-sweep";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Cancelled, failImport, runImport, scanImport } from "../src/lib/jira/engine";
import { snapshotActiveSprints } from "../src/lib/sprint-stats";
import { refreshCardCourses } from "../src/lib/courseforge";
import { retryPendingPushes } from "../src/lib/suite-push";
import { handleEvent, runScheduled } from "../src/lib/automation/engine";
import { JiraError } from "../src/lib/jira/client";

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

// Jira imports (docs/JIRA-PARITY.md, phase 5). A job that dies part way (a restart, a
// network blip) is retried and resumes from the page it saved; Jira refusing the
// credentials isn't retried. The token is dropped when the run ends either way.
const importWorker = new Worker(
  "jira-import",
  async (job) => {
    const importId = String(job.data?.importId ?? "");
    const deps = {
      prisma,
      putObject: async (key: string, bytes: Uint8Array, contentType: string) => {
        await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET ?? "tavoro", Key: key, Body: bytes, ContentType: contentType }));
      },
    };
    try {
      if (job.name === "scan") await scanImport(deps, importId);
      else await runImport(deps, importId);
      console.log(`[worker] jira ${job.name} ${importId} finished`);
    } catch (err) {
      // Refused credentials or a bad setup (status 0) won't fix themselves; network errors (-1) and 5xx might.
      const fatal = err instanceof JiraError && (err.status === 401 || err.status === 403 || err.status === 0);
      const last = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      console.error(`[worker] jira ${job.name} ${importId} failed (attempt ${job.attemptsMade + 1}):`, err);
      if (fatal || last || err instanceof Cancelled) {
        await failImport(deps, importId, err);
        return { ok: false };
      }
      throw err;
    }
    return { ok: true };
  },
  { connection, concurrency: 1, lockDuration: 120_000 },
);
importWorker.on("failed", (job, err) => console.error(`[worker] jira-import job ${job?.id} failed:`, err));

// Nightly sprint snapshots for burndowns (lib/sprint-stats.ts), just before midnight UTC.
const sprintDaysQueue = new Queue("sprint-days", { connection });
sprintDaysQueue
  .add("snapshot", {}, { repeat: { pattern: "55 23 * * *" }, removeOnComplete: true, removeOnFail: 50 })
  .then(() => console.log("[worker] scheduled nightly sprint snapshots (23:55 UTC)"))
  .catch((err) => console.error("[worker] failed to schedule sprint snapshots:", err));
const sprintDaysWorker = new Worker(
  "sprint-days",
  async () => {
    const n = await snapshotActiveSprints(prisma);
    console.log(`[worker] sprint snapshots: ${n} active sprint(s)`);
    return { ok: true, sprints: n };
  },
  { connection },
);
sprintDaysWorker.on("failed", (job, err) => console.error(`[worker] sprint-days job ${job?.id} failed:`, err));

// Course summaries on linked cards (docs/SUITE.md, step 2): every ten minutes, the
// stale ones are refreshed from their connected app, so board badges stay current.
const suiteQueue = new Queue("suite", { connection });
suiteQueue
  .add("refresh-courses", {}, { repeat: { pattern: "*/10 * * * *" }, removeOnComplete: true, removeOnFail: 50 })
  .then(() => console.log("[worker] scheduled course refresh (every 10 min)"))
  .catch((err) => console.error("[worker] failed to schedule course refresh:", err));
const suiteWorker = new Worker(
  "suite",
  async () => ({ ok: true, refreshed: await refreshCardCourses(prisma, { staleOnly: true }), pushed: await retryPendingPushes(prisma) }),
  { connection, concurrency: 1 },
);
suiteWorker.on("failed", (job, err) => console.error(`[worker] suite job ${job?.id} failed:`, err));

// Automation rules (docs/JIRA-PARITY.md, phase 9): card-change events, and a daily run
// at 07:00 UTC for "due in N days" and scheduled rules.
const automationWorker = new Worker(
  "automation",
  async (job) => {
    if (job.name === "daily") {
      const r = await runScheduled(prisma);
      console.log(`[worker] automation daily: ${r.ran} rule run(s)`);
      return r;
    }
    return handleEvent(prisma, job.data);
  },
  { connection, concurrency: 1 },
);
automationWorker.on("failed", (job, err) => console.error(`[worker] automation job ${job?.id} failed:`, err));
const automationQueue = new Queue("automation", { connection });
automationQueue
  .add("daily", {}, { repeat: { pattern: "0 7 * * *" }, removeOnComplete: true, removeOnFail: 50 })
  .then(() => console.log("[worker] scheduled daily automation (07:00 UTC)"))
  .catch((err) => console.error("[worker] failed to schedule automation:", err));

console.log("[worker] starting…");

async function shutdown() {
  console.log("[worker] shutting down…");
  await worker.close();
  await emailWorker.close();
  await remindersWorker.close();
  await maintenanceWorker.close();
  await importWorker.close();
  await sprintDaysWorker.close();
  await sprintDaysQueue.close();
  await automationWorker.close();
  await suiteWorker.close();
  await suiteQueue.close();
  await automationQueue.close();
  await lmsQueue.close();
  await remindersQueue.close();
  await maintenanceQueue.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
