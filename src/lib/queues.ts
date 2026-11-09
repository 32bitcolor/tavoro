// Not tagged "server-only" — this is intentionally shared with worker/index.ts,
// a standalone Node/tsx process, not a Next.js server context.
import { Queue, type ConnectionOptions } from "bullmq";

// Plain {host, port} connection, not a shared ioredis instance — mirrors
// worker/index.ts's own connection, which documents why sharing an ioredis
// client with BullMQ trips a structural type mismatch.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection: ConnectionOptions = { host: redisUrl.hostname, port: Number(redisUrl.port) || 6379 };

const globalForQueue = globalThis as unknown as { emailQueue?: Queue };
export const emailQueue = globalForQueue.emailQueue ?? new Queue("email", { connection });
if (process.env.NODE_ENV !== "production") globalForQueue.emailQueue = emailQueue;

// Fire-and-forget from the caller's perspective: a Redis hiccup while enqueuing
// must never fail the underlying approve/reject/submit action, so failures here
// are logged, not thrown — same fail-open posture as checkIntakeThrottle.
export async function enqueueEmail(msg: { to: string; subject: string; html: string; text: string; replyTo?: string }): Promise<void> {
  try {
    await emailQueue.add("send", msg, { attempts: 3, backoff: { type: "exponential", delay: 5000 } });
  } catch (err) {
    console.error("[email] failed to enqueue", err);
  }
}

// Jira imports (lib/jira/engine.ts) run on the worker: "scan" (the dry run) and
// "import". One at a time per worker, so a big import can't starve the others.
const globalForImport = globalThis as unknown as { importQueue?: Queue };
export const importQueue = globalForImport.importQueue ?? new Queue("jira-import", { connection });
if (process.env.NODE_ENV !== "production") globalForImport.importQueue = importQueue;

export async function enqueueJiraImport(kind: "scan" | "import", importId: string): Promise<void> {
  await importQueue.add(kind, { importId }, { jobId: `${kind}-${importId}-${Date.now()}`, attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 100, removeOnFail: 100 });
}
