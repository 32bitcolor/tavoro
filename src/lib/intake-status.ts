import "server-only";
import { readAnswers } from "@/lib/intake-fields";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/app-url";

// Requester status pages: /status/<requestId>-<mac>, mac = HMAC-SHA256(SESSION_SECRET,
// intake-status:id:nonce). The same scheme as public board links (lib/board-share.ts):
// only the nonce is stored, so a database dump can't produce a link, and a new nonce
// ("Reset link") kills the old one. The requester needs no account; the link is the key.
//
// The page shows the requester only what they sent and what the team chose to tell
// them: status, outcome, and "reply" messages. Never internal notes, scores, who it's
// assigned to, or the project it became.

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set.");
  return s;
}

export function newStatusNonce(): string {
  return randomBytes(24).toString("base64url");
}

function mac(id: string, nonce: string): string {
  return createHmac("sha256", secret()).update(`intake-status:${id}:${nonce}`).digest("base64url");
}

export function statusToken(r: { id: string; statusNonce: string }): string {
  return `${r.id}-${mac(r.id, r.statusNonce)}`;
}

export function statusPath(r: { id: string; statusNonce: string }): string {
  return `/status/${statusToken(r)}`;
}

/** The absolute link for emails; undefined when APP_URL isn't set. */
export function statusUrl(r: { id: string; statusNonce: string }): string | undefined {
  return appUrl(statusPath(r));
}

function parse(token: string): string | null {
  // A cuid has no "-", so the first one splits the id from the MAC.
  const m = /^([a-z0-9]{20,40})-([A-Za-z0-9_-]{43})$/.exec(token);
  return m ? m[1] : null;
}

/** The request a status link points at, if the link is current and intake is on. */
export async function requestForStatusToken(token: string) {
  const id = parse(token);
  if (!id) return null;
  const r = await prisma.intakeRequest.findUnique({
    where: { id },
    select: {
      id: true,
      statusNonce: true,
      number: true,
      title: true,
      description: true,
      targetAudience: true,
      targetDate: true,
      answers: true,
      requesterName: true,
      requesterEmail: true,
      status: true,
      rejectionReason: true,
      createdAt: true,
      decidedAt: true,
      workspaceId: true,
      assignedToId: true,
      impactScore: true,
      effortScore: true,
      workspace: { select: { name: true, intakeEnabled: true } },
    },
  });
  if (!r) return null;
  const expected = Buffer.from(statusToken(r));
  const given = Buffer.from(token);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return r;
}

/** Everything the status page shows, already limited to what the requester may see. */
export async function loadStatusPage(token: string) {
  const r = await requestForStatusToken(token);
  if (!r) return null;
  const messages = await prisma.intakeMessage.findMany({
    where: { requestId: r.id, kind: "reply" },
    orderBy: { createdAt: "asc" },
    select: { id: true, body: true, fromRequester: true, createdAt: true, author: { select: { name: true } } },
  });
  return {
    workspaceName: r.workspace.name,
    number: r.number,
    title: r.title,
    description: r.description,
    targetAudience: r.targetAudience,
    targetDate: r.targetDate?.toISOString() ?? null,
    answers: readAnswers(r.answers),
    requesterName: r.requesterName,
    status: r.status,
    rejectionReason: r.status === "rejected" ? r.rejectionReason : null,
    submittedAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    messages: messages.map((m) => ({
      id: m.id,
      body: m.body,
      fromRequester: m.fromRequester,
      // Team members by name only; "The team" if their account has no name.
      author: m.fromRequester ? r.requesterName : (m.author?.name?.trim() || `The ${r.workspace.name} team`),
      at: m.createdAt.toISOString(),
    })),
  };
}
export type StatusPage = NonNullable<Awaited<ReturnType<typeof loadStatusPage>>>;
