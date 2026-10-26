"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma, Role } from "@/generated/prisma/client";
import { getCurrentUser, getWorkspaceAdmin } from "@/lib/dal";
import { getIntakeRequestForUser } from "@/lib/authz";
import { createProjectForWorkspace } from "@/lib/projects";
import { checkIntakeThrottle } from "@/lib/intake-throttle";
import { checkThrottle } from "@/lib/throttle";
import { canDecideIntake, canWorkIntake, isResolved, projectDescriptionFrom, ticketLabel, triageStatusFor } from "@/lib/intake";
import { enqueueEmail } from "@/lib/queues";
import { intakeSubmittedConfirmation, newIntakeRequestForAdmin, intakeApprovedNotification, intakeRejectedNotification, intakeAssigned, intakeMessageToRequester, withLink } from "@/lib/email-templates";
import { appUrl } from "@/lib/app-url";
import { newStatusNonce, statusPath, statusUrl } from "@/lib/intake-status";
import { notificationsEnabled } from "@/lib/notify";

const Requester = z.object({
  name: z.string().trim().min(1, "Your name is required").max(140),
  email: z.string().trim().email("Enter a valid email"),
});
const IntakeInput = z.object({
  title: z.string().trim().min(1, "A title is required").max(140),
  description: z.string().trim().min(1, "Tell us what you need").max(4000),
  targetAudience: z.string().trim().max(280).optional(),
  targetDate: z.string().optional(),
});
const Score = z.number().int().min(1).max(5);

function revalidateIntake() {
  revalidatePath("/intake");
  revalidatePath("/", "layout");
}


// ── Public submission — intentionally the one action in this app with no auth ──

export async function submitIntakeRequest(
  workspaceId: string,
  formData: FormData,
): Promise<{ ok: true; ticket: string; statusPath?: string } | { error: string }> {
  // Honeypot: real users never see/fill this field. Pretend success so bots
  // don't learn they were caught.
  if (typeof formData.get("website") === "string" && formData.get("website") !== "") {
    return { ok: true as const, ticket: "" };
  }

  const allowed = await checkIntakeThrottle(workspaceId);
  if (!allowed) return { error: "Too many requests from this network — please try again later." };

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true, intakeEnabled: true },
  });
  if (!workspace?.intakeEnabled) return { error: "This intake form is not currently accepting requests." };

  const requester = Requester.safeParse({ name: formData.get("name"), email: formData.get("email") });
  if (!requester.success) return { error: requester.error.issues[0]?.message ?? "Invalid submission." };
  const input = IntakeInput.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    targetAudience: formData.get("targetAudience") || undefined,
    targetDate: formData.get("targetDate") || undefined,
  });
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid submission." };

  const targetDate = input.data.targetDate ? new Date(input.data.targetDate) : null;
  if (targetDate && Number.isNaN(targetDate.getTime())) return { error: "Invalid target date." };

  const me = await getCurrentUser();

  let request;
  try {
    request = await prisma.$transaction(
      async (tx) => {
        const last = await tx.intakeRequest.findFirst({
          where: { workspaceId },
          orderBy: { number: "desc" },
          select: { number: true },
        });
        return tx.intakeRequest.create({
          data: {
            workspaceId,
            number: (last?.number ?? 0) + 1,
            requesterName: requester.data.name,
            requesterEmail: requester.data.email,
            requestedById: me?.id,
            title: input.data.title,
            description: input.data.description,
            targetAudience: input.data.targetAudience || null,
            targetDate,
          },
          select: { id: true, number: true, statusNonce: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch {
    return { error: "Couldn't submit your request — please try again." };
  }

  const ticket = ticketLabel(request.number);
  // The requester confirmation is transactional (a reply to their submission)
  // and always sends; the admin heads-up is gated by the "intake" toggle.
  const notifyAdmins = await notificationsEnabled(workspaceId, "intake");
  const admins = notifyAdmins
    ? await prisma.membership.findMany({
        where: { workspaceId, role: Role.ADMIN, suspendedAt: null },
        select: { user: { select: { email: true } } },
      })
    : [];
  // The form is public and the address is whatever was typed, so cap confirmations
  // per address: the form can't be used to flood someone's inbox.
  const confirm = await checkThrottle(`intake-to:${requester.data.email.toLowerCase()}`, 5, 86_400);
  await Promise.all([
    confirm &&
      enqueueEmail({
        to: requester.data.email,
        ...withLink(
          intakeSubmittedConfirmation({ ticket, title: input.data.title, workspaceName: workspace.name }),
          statusUrl(request),
          "Track your request",
        ),
      }),
    ...admins.map((m) =>
      enqueueEmail({
        to: m.user.email,
        ...withLink(
          newIntakeRequestForAdmin({
            ticket,
            title: input.data.title,
            requesterName: requester.data.name,
            workspaceName: workspace.name,
          }),
          appUrl("/intake"),
        ),
      }),
    ),
  ]);

  revalidateIntake();
  return { ok: true as const, ticket, statusPath: statusPath(request) };
}

// ── Triage (authenticated) ──────────────────────────────────────────────────
// Who may do what lives in lib/intake.ts (canDecideIntake / canWorkIntake).

async function access(requestId: string) {
  const request = await getIntakeRequestForUser(requestId);
  if (!request) return null;
  const me = await getCurrentUser();
  if (!me) return null;
  const membership = await prisma.membership.findFirst({
    where: { userId: me.id, workspaceId: request.workspaceId, suspendedAt: null },
    select: { role: true },
  });
  return {
    request,
    me,
    decide: canDecideIntake(membership?.role),
    work: canWorkIntake(membership?.role, me.id, request.assignedToId),
  };
}

const NOT_FOUND = { error: "Request not found." };
const DECIDE_ONLY = { error: "Only admins and managers can do that." };
const WORK_ONLY = { error: "Only admins, managers and the assigned member can do that." };
const RESOLVED = { error: "This request has already been decided." };

function revalidateRequest(id: string) {
  revalidateIntake();
  revalidatePath(`/intake/${id}`);
  revalidatePath("/my-work");
}

export async function scoreIntakeRequest(
  requestId: string,
  impact: number,
  effort: number,
): Promise<{ error: string } | undefined> {
  const a = await access(requestId);
  if (!a) return NOT_FOUND;
  if (!a.work) return WORK_ONLY;
  if (isResolved(a.request.status)) return RESOLVED;
  const impactParsed = Score.safeParse(impact);
  const effortParsed = Score.safeParse(effort);
  if (!impactParsed.success || !effortParsed.success) return { error: "Scores must be 1-5." };

  await prisma.intakeRequest.update({
    where: { id: requestId },
    data: {
      impactScore: impactParsed.data,
      effortScore: effortParsed.data,
      status: a.request.status === "submitted" ? "triaging" : a.request.status,
    },
  });
  revalidateRequest(requestId);
}

export async function assignIntakeRequest(
  requestId: string,
  userId: string | null,
): Promise<{ error: string } | undefined> {
  const a = await access(requestId);
  if (!a) return NOT_FOUND;
  if (!a.decide) return DECIDE_ONLY;

  let assignee: { email: string; name: string | null } | null = null;
  if (userId) {
    const member = await prisma.membership.findFirst({
      where: { userId, workspaceId: a.request.workspaceId, suspendedAt: null },
      select: { user: { select: { email: true, name: true } } },
    });
    if (!member) return { error: "Must be a workspace member." };
    assignee = member.user;
  }

  await prisma.intakeRequest.update({ where: { id: requestId }, data: { assignedToId: userId } });

  // Tell the new assignee, unless they assigned it to themselves.
  if (assignee && userId !== a.me.id && userId !== a.request.assignedToId && (await notificationsEnabled(a.request.workspaceId, "assignment"))) {
    await enqueueEmail({
      to: assignee.email,
      ...withLink(
        intakeAssigned({
          ticket: ticketLabel(a.request.number),
          title: a.request.title,
          requesterName: a.request.requesterName,
          assignerName: a.me.name ?? a.me.email,
        }),
        appUrl(`/intake/${requestId}`),
      ),
    });
  }
  revalidateRequest(requestId);
}

const ApproveInput = z.object({
  name: z.string().trim().min(1, "The project needs a name.").max(120),
  methodology: z.enum(["ADDIE", "SAM", "CUSTOM"]),
});

/** Approve: create the project (named, with a methodology), carrying the request's
 *  details into its description and its needed-by date as a milestone. */
export async function approveIntakeRequest(
  requestId: string,
  options?: { name?: string; methodology?: "ADDIE" | "SAM" | "CUSTOM" },
): Promise<{ error: string } | { project: { id: string } }> {
  const a = await access(requestId);
  if (!a) return NOT_FOUND;
  if (!a.decide) return DECIDE_ONLY;
  if (isResolved(a.request.status)) return RESOLVED;
  const parsed = ApproveInput.safeParse({ name: options?.name ?? a.request.title, methodology: options?.methodology ?? "ADDIE" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid project." };

  const r = a.request;
  const project = await createProjectForWorkspace(r.workspaceId, parsed.data.name, parsed.data.methodology, {
    description: projectDescriptionFrom(r),
    milestone: r.targetDate ? { name: `Needed by ${r.requesterName}`.slice(0, 120), dueDate: r.targetDate } : null,
  });
  await prisma.intakeRequest.update({
    where: { id: requestId },
    data: { status: "converted", convertedProjectId: project.id, decidedById: a.me.id, decidedAt: new Date(), rejectionReason: null },
  });

  await enqueueEmail({
    to: r.requesterEmail,
    ...withLink(
      intakeApprovedNotification({ ticket: ticketLabel(r.number), title: r.title, workspaceName: r.workspace.name }),
      statusUrl(r),
      "View your request",
    ),
  });

  revalidateRequest(requestId);
  revalidatePath("/projects");
  return { project };
}

export async function rejectIntakeRequest(
  requestId: string,
  reason: string,
): Promise<{ error: string } | undefined> {
  const a = await access(requestId);
  if (!a) return NOT_FOUND;
  if (!a.decide) return DECIDE_ONLY;
  if (isResolved(a.request.status)) return RESOLVED;
  const rejectionReason = reason.trim() ? reason.trim().slice(0, 500) : null;
  await prisma.intakeRequest.update({
    where: { id: requestId },
    data: { status: "rejected", rejectionReason, decidedById: a.me.id, decidedAt: new Date() },
  });

  await enqueueEmail({
    to: a.request.requesterEmail,
    ...withLink(
      intakeRejectedNotification({
        ticket: ticketLabel(a.request.number),
        title: a.request.title,
        workspaceName: a.request.workspace.name,
        reason: rejectionReason,
      }),
      statusUrl(a.request),
      "View your request",
    ),
  });

  revalidateRequest(requestId);
}

/** Put a rejected request back in the queue. The requester isn't emailed: they hear
 *  again when it's decided. */
export async function reopenIntakeRequest(requestId: string): Promise<{ error: string } | undefined> {
  const a = await access(requestId);
  if (!a) return NOT_FOUND;
  if (!a.decide) return DECIDE_ONLY;
  if (a.request.status !== "rejected") return { error: "Only a rejected request can be reopened." };
  await prisma.intakeRequest.update({
    where: { id: requestId },
    data: { status: triageStatusFor(a.request), rejectionReason: null, decidedById: null, decidedAt: null },
  });
  revalidateRequest(requestId);
}

const MessageBody = z.string().trim().min(1, "Write a message first.").max(5000, "Keep it under 5,000 characters.");

/** Add to a request's conversation. A "reply" is emailed to the requester and shows on
 *  their status page (with needsInfo, the request waits in Needs info until they
 *  answer); a "note" is internal. Admins, managers and the assigned member. */
export async function postIntakeMessage(
  requestId: string,
  input: { body: string; kind: "reply" | "note"; needsInfo?: boolean },
): Promise<{ error: string } | undefined> {
  const a = await access(requestId);
  if (!a) return NOT_FOUND;
  if (!a.work) return WORK_ONLY;
  const parsed = MessageBody.safeParse(input.body);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid message." };
  const needsInfo = input.kind === "reply" && !!input.needsInfo;
  if (needsInfo && isResolved(a.request.status)) return RESOLVED;

  await prisma.intakeMessage.create({
    data: { requestId, kind: input.kind, authorId: a.me.id, body: parsed.data },
  });
  if (needsInfo) await prisma.intakeRequest.update({ where: { id: requestId }, data: { status: "needs_info" } });

  if (input.kind === "reply") {
    await enqueueEmail({
      to: a.request.requesterEmail,
      // An email reply reaches the person who wrote, not a no-reply inbox.
      replyTo: a.me.email,
      ...withLink(
        intakeMessageToRequester({
          ticket: ticketLabel(a.request.number),
          title: a.request.title,
          workspaceName: a.request.workspace.name,
          authorName: a.me.name ?? a.me.email,
          body: parsed.data,
          question: needsInfo,
        }),
        statusUrl(a.request),
        "View and reply",
      ),
    });
  }
  revalidateRequest(requestId);
}

/** "Ask the requester": a reply that marks the request Needs info. */
export async function askIntakeRequester(requestId: string, question: string): Promise<{ error: string } | undefined> {
  return postIntakeMessage(requestId, { body: question, kind: "reply", needsInfo: true });
}

/** A new status-page link for the requester; the old one stops working. */
export async function resetIntakeStatusLink(requestId: string): Promise<{ error: string } | { url: string }> {
  const a = await access(requestId);
  if (!a) return NOT_FOUND;
  if (!a.work) return WORK_ONLY;
  const updated = await prisma.intakeRequest.update({
    where: { id: requestId },
    data: { statusNonce: newStatusNonce() },
    select: { id: true, statusNonce: true },
  });
  revalidateRequest(requestId);
  return { url: statusUrl(updated) ?? statusPath(updated) };
}

/** The requester answered: back to triage. */
export async function resumeIntakeTriage(requestId: string): Promise<{ error: string } | undefined> {
  const a = await access(requestId);
  if (!a) return NOT_FOUND;
  if (!a.work) return WORK_ONLY;
  if (a.request.status !== "needs_info") return { error: "This request isn't waiting on the requester." };
  await prisma.intakeRequest.update({ where: { id: requestId }, data: { status: triageStatusFor(a.request) } });
  revalidateRequest(requestId);
}

// ── Settings ─────────────────────────────────────────────────────────────────

const IntakeSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, "Use 3–48 lowercase letters, numbers and hyphens, starting and ending with a letter or number.");

/** Change the intake link (/request/<slug>). The old address keeps working: the public
 *  page forwards any former slug to the current one. */
export async function setIntakeSlug(raw: string): Promise<{ error: string } | { slug: string }> {
  const admin = await getWorkspaceAdmin();
  if (!admin) return { error: "You must be a workspace admin." };
  const parsed = IntakeSlug.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid link." };
  const slug = parsed.data;
  const ws = await prisma.workspace.findUnique({ where: { id: admin.workspaceId }, select: { slug: true, formerSlugs: true } });
  if (!ws) return { error: "Workspace not found." };
  if (slug === ws.slug) return { slug };
  const taken = await prisma.workspace.findFirst({
    where: { id: { not: admin.workspaceId }, OR: [{ slug }, { formerSlugs: { has: slug } }] },
    select: { id: true },
  });
  if (taken) return { error: "Another workspace uses that link. Pick a different one." };
  // Remember the old address (most recent first, at most 10), and drop the new one if
  // this workspace used it before.
  const formerSlugs = [ws.slug, ...ws.formerSlugs.filter((s) => s !== slug && s !== ws.slug)].slice(0, 10);
  await prisma.workspace.update({ where: { id: admin.workspaceId }, data: { slug, formerSlugs } });
  revalidatePath("/settings/intake");
  return { slug };
}

export async function setIntakeEnabled(enabled: boolean): Promise<{ error: string } | undefined> {
  const admin = await getWorkspaceAdmin();
  if (!admin) return { error: "You must be a workspace admin." };
  await prisma.workspace.update({ where: { id: admin.workspaceId }, data: { intakeEnabled: enabled } });
  revalidatePath("/settings/intake");
}
