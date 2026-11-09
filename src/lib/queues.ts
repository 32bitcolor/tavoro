// Not tagged "server-only" — this is intentionally shared with worker/index.ts,
// a standalone Node/tsx process, not a Next.js server context.
import { AsyncLocalStorage } from "node:async_hooks";
import { Queue, type ConnectionOptions } from "bullmq";
import { bulkDigest } from "./email-templates";

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
type EmailMsg = { to: string; subject: string; html: string; text: string; replyTo?: string };

// A bulk edit (cards page, MCP) runs the same per-card code as single edits, which
// emails as it goes. Inside withEmailDigest those emails are collected instead, and
// each recipient gets one: their only email unchanged, or a digest of all of them.
const digest = new AsyncLocalStorage<EmailMsg[]>();

export async function withEmailDigest<T>(actorName: string, fn: () => Promise<T>): Promise<T> {
  const batch: EmailMsg[] = [];
  const result = await digest.run(batch, fn);
  const byTo = new Map<string, EmailMsg[]>();
  for (const m of batch) byTo.set(m.to.toLowerCase(), [...(byTo.get(m.to.toLowerCase()) ?? []), m]);
  for (const [to, msgs] of byTo) {
    if (msgs.length === 1) await send(msgs[0]);
    else {
      const items = msgs.map((m) => ({ subject: m.subject, url: /\n\n(https?:\/\/\S+)\s*$/.exec(m.text)?.[1] }));
      await send({ to, ...bulkDigest({ actorName, count: msgs.length, items }) });
    }
  }
  return result;
}

export async function enqueueEmail(msg: EmailMsg): Promise<void> {
  const batch = digest.getStore();
  if (batch) {
    batch.push(msg);
    return;
  }
  await send(msg);
}

async function send(msg: EmailMsg): Promise<void> {
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

// Automation (lib/automation/engine.ts): card changes become events the worker matches
// against rules. Fail-open like email: a Redis hiccup never fails the change itself.
export type AutomationEvent = {
  cardId: string;
  trigger: "card_created" | "status_changed" | "field_changed" | "comment_added" | "subtasks_done";
  field?: string;
  data?: Record<string, unknown>;
  /** How many rule runs led here (a rule's own changes are depth + 1). */
  depth: number;
};
const globalForAutomation = globalThis as unknown as { automationQueue?: Queue };
export const automationQueue = globalForAutomation.automationQueue ?? new Queue("automation", { connection });
if (process.env.NODE_ENV !== "production") globalForAutomation.automationQueue = automationQueue;

export async function enqueueAutomation(ev: AutomationEvent): Promise<void> {
  if (process.env.AUTOMATION_DISABLED === "1") return;
  try {
    await automationQueue.add("event", ev, { removeOnComplete: 1000, removeOnFail: 500, attempts: 2, backoff: { type: "exponential", delay: 5000 } });
  } catch (err) {
    console.error("[automation] failed to enqueue", err);
  }
}
