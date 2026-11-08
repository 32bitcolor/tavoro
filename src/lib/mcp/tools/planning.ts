import "server-only";
import { readAnswers } from "@/lib/intake-fields";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { boardVisibilityWhere, getIntakeRequestForUser } from "@/lib/authz";
import { canDecideIntake, INTAKE_STATUSES, priorityScore, quadrantLabel, ticketLabel } from "@/lib/intake";
import { SPRINT_STATUSES } from "@/lib/sprint";
import {
  approveIntakeRequest,
  askIntakeRequester,
  assignIntakeRequest,
  postIntakeMessage,
  rejectIntakeRequest,
  reopenIntakeRequest,
  resumeIntakeTriage,
  scoreIntakeRequest,
} from "@/app/actions/intake";
import { createSprint, renameSprint, setSprintDates, setSprintStatus } from "@/app/actions/sprints";
import { check, day, link, parseDate, principal, tool, ToolError } from "@/lib/mcp/util";
import { resolveMember, resolveSprint } from "@/lib/mcp/tools/cards";
import { cardHref } from "@/lib/mcp/tools/workspace";

// Intake (requests from stakeholders) and sprints: the planning side of the workspace.

async function resolveIntake(ref: string) {
  const m = /^REQ-?(\d+)$/i.exec(ref.trim());
  const row = m
    ? await prisma.intakeRequest.findFirst({ where: { workspaceId: principal().workspaceId, number: Number(m[1]) }, select: { id: true } })
    : { id: ref.trim() };
  const req = row && (await getIntakeRequestForUser(row.id));
  if (!req) throw new ToolError(`No intake request ${ref}.`);
  return req.id;
}

// Requester emails are for admins and managers, as in the app.
async function seesRequesterEmail(): Promise<boolean> {
  const p = principal();
  const m = await prisma.membership.findFirst({ where: { userId: p.userId, workspaceId: p.workspaceId, suspendedAt: null }, select: { role: true } });
  return canDecideIntake(m?.role);
}

export async function loadIntake(id: string, showEmail?: boolean) {
  const withEmail = showEmail ?? (await seesRequesterEmail());
  const r = await prisma.intakeRequest.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      number: true,
      title: true,
      description: true,
      requesterName: true,
      requesterEmail: true,
      targetAudience: true,
      targetDate: true,
      answers: true,
      impactScore: true,
      effortScore: true,
      status: true,
      rejectionReason: true,
      decidedAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: { kind: true, fromRequester: true, body: true, createdAt: true, author: { select: { name: true, email: true } } },
      },
      decidedBy: { select: { name: true, email: true } },
      createdAt: true,
      assignedTo: { select: { id: true, name: true, email: true } },
      convertedProject: { select: { id: true, name: true } },
    },
  });
  return {
    id: r.id,
    ticket: ticketLabel(r.number),
    title: r.title,
    status: r.status,
    description: r.description,
    requester: { name: r.requesterName, ...(withEmail ? { email: r.requesterEmail } : {}) },
    targetAudience: r.targetAudience,
    targetDate: day(r.targetDate),
    answers: readAnswers(r.answers).map((a) => ({ question: a.label, answer: a.value })),
    impact: r.impactScore,
    effort: r.effortScore,
    priority: r.impactScore && r.effortScore ? priorityScore(r.impactScore, r.effortScore) : null,
    quadrant: quadrantLabel(r.impactScore, r.effortScore),
    assignedTo: r.assignedTo,
    rejectionReason: r.rejectionReason,
    // The conversation: "reply" messages are shared with the requester; "note" is internal.
    conversation: r.messages.map((m) => ({
      kind: m.kind,
      from: m.fromRequester ? `${r.requesterName} (requester)` : m.author ? (m.author.name ?? m.author.email) : "The team",
      at: m.createdAt.toISOString(),
      body: m.body,
    })),
    decided: r.decidedAt ? { on: day(r.decidedAt), by: r.decidedBy ? (r.decidedBy.name ?? r.decidedBy.email) : null } : null,
    project: r.convertedProject ? { ...r.convertedProject, url: link(`/projects/${r.convertedProject.id}`) } : null,
    submitted: day(r.createdAt),
    url: link(`/intake/${r.id}`),
  };
}

export function registerPlanningTools(server: McpServer) {
  tool(
    server,
    "list_intake",
    {
      title: "List intake requests",
      description: "Training requests submitted through the intake form, newest first, with triage scores and status.",
      input: { status: z.enum(INTAKE_STATUSES).optional() },
      kind: "read",
    },
    async ({ status }) => {
      const rows = await prisma.intakeRequest.findMany({
        where: { workspaceId: principal().workspaceId, ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true },
      });
      const withEmail = await seesRequesterEmail();
      return Promise.all(rows.map((r) => loadIntake(r.id, withEmail).then(({ description, ...rest }) => ({ ...rest, description: description.slice(0, 300) }))));
    },
  );

  tool(
    server,
    "get_intake",
    { title: "Get an intake request", description: "One intake request in full (by id or ticket such as REQ-4).", input: { request: z.string().min(1) }, kind: "read" },
    async ({ request }) => loadIntake(await resolveIntake(request)),
  );

  tool(
    server,
    "triage_intake",
    {
      title: "Triage an intake request",
      description:
        "Work an intake request. Admins, managers and the assigned member can score it (impact and effort, 1–5), ask the requester a question (emailed and shown on their status page; the request waits in needs_info until they reply there, or resume), reply to the requester, and add internal notes. Only admins and managers can assign it (member id, email or name; empty string unassigns), approve it (creates a project carrying the request's details; optional project_name and methodology), reject it (with a reason, emailed to the requester) or reopen a rejected one.",
      input: {
        request: z.string().min(1).describe("Request id or ticket such as REQ-4"),
        impact: z.number().int().min(1).max(5).optional(),
        effort: z.number().int().min(1).max(5).optional(),
        assign_to: z.string().optional(),
        decision: z.enum(["approve", "reject", "reopen", "ask", "resume"]).optional(),
        reply_to_requester: z.string().max(5000).optional().describe("Emailed to the requester and shown on their status page"),
        internal_note: z.string().max(5000).optional().describe("Added to the conversation for the team only"),
        rejection_reason: z.string().max(500).optional(),
        question: z.string().max(2000).optional().describe("For decision 'ask': the question emailed to the requester"),
        project_name: z.string().max(120).optional().describe("For 'approve': defaults to the request title"),
        methodology: z.enum(["ADDIE", "SAM", "CUSTOM"]).optional().describe("For 'approve': defaults to ADDIE"),
      },
      kind: "write",
    },
    async (a) => {
      const id = await resolveIntake(a.request);
      if (a.impact != null || a.effort != null) {
        const cur = await prisma.intakeRequest.findUniqueOrThrow({ where: { id }, select: { impactScore: true, effortScore: true } });
        const impact = a.impact ?? cur.impactScore;
        const effort = a.effort ?? cur.effortScore;
        if (impact == null || effort == null) throw new ToolError("Give both impact and effort the first time.");
        check(await scoreIntakeRequest(id, impact, effort));
      }
      if (a.assign_to !== undefined) check(await assignIntakeRequest(id, a.assign_to ? (await resolveMember(a.assign_to)).id : null));
      if (a.decision === "approve") check(await approveIntakeRequest(id, { name: a.project_name, methodology: a.methodology }));
      if (a.decision === "reject") check(await rejectIntakeRequest(id, a.rejection_reason ?? ""));
      if (a.decision === "reopen") check(await reopenIntakeRequest(id));
      if (a.decision === "ask") check(await askIntakeRequester(id, a.question ?? ""));
      if (a.decision === "resume") check(await resumeIntakeTriage(id));
      if (a.reply_to_requester) check(await postIntakeMessage(id, { body: a.reply_to_requester, kind: "reply" }));
      if (a.internal_note) check(await postIntakeMessage(id, { body: a.internal_note, kind: "note" }));
      return loadIntake(id);
    },
  );

  tool(
    server,
    "get_sprint",
    {
      title: "Get a sprint",
      description: "A sprint's goal, dates, estimate totals (planned and done) and every card in it across all boards, grouped by status. sprint = name, id, or 'active'.",
      input: { sprint: z.string().min(1).default("active") },
      kind: "read",
    },
    async ({ sprint }) => {
      const s = await resolveSprint(sprint);
      const full = await prisma.sprint.findUniqueOrThrow({ where: { id: s.id }, select: { id: true, name: true, goal: true, status: true, startDate: true, endDate: true } });
      const cards = await prisma.card.findMany({
        where: { sprintId: s.id, column: { board: { workspaceId: principal().workspaceId, ...(await boardVisibilityWhere()) } } },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          keySeq: true,
          dueDate: true,
          type: true,
          priority: true,
          estimate: true,
          status: { select: { name: true, category: true } },
          column: { select: { board: { select: { id: true, name: true, cardKeyPrefix: true } } } },
          assignees: { select: { user: { select: { name: true, email: true } } } },
        },
      });
      const byStatus: Record<string, unknown[]> = {};
      for (const c of cards) {
        const k = c.status?.name ?? "No status";
        (byStatus[k] ??= []).push({
          id: c.id,
          key: c.column?.board.cardKeyPrefix && c.keySeq ? `${c.column.board.cardKeyPrefix}-${c.keySeq}` : null,
          title: c.title,
          type: c.type,
          priority: c.priority ?? undefined,
          estimate: c.estimate ?? undefined,
          board: c.column?.board.name,
          due: day(c.dueDate),
          assignees: c.assignees.map((x) => x.user.name ?? x.user.email),
          url: cardHref(c.column!.board.id, c.id),
        });
      }
      const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: principal().workspaceId }, select: { estimateUnit: true } });
      const total = cards.reduce((n, c) => n + (c.estimate ?? 0), 0);
      const done = cards.filter((c) => c.status?.category === "done").reduce((n, c) => n + (c.estimate ?? 0), 0);
      return {
        ...full,
        startDate: day(full.startDate),
        endDate: day(full.endDate),
        url: link("/sprints"),
        estimate: { unit: ws.estimateUnit, total, done },
        cardsByStatus: byStatus,
      };
    },
  );

  tool(
    server,
    "create_sprint",
    {
      title: "Create a sprint",
      description: "A new planned sprint with an optional goal and dates. Add cards to it with update_card (sprint).",
      input: { name: z.string().min(1).max(120), goal: z.string().max(500).optional(), start: z.string().optional(), end: z.string().optional() },
      kind: "write",
    },
    async ({ name, goal, start, end }) => {
      const { sprint } = check(await createSprint(name, goal));
      if (!sprint) throw new ToolError("Couldn't create the sprint.");
      if (start || end) check(await setSprintDates(sprint.id, parseDate(start), parseDate(end)));
      return { id: sprint.id, name, url: link("/sprints") };
    },
  );

  tool(
    server,
    "update_sprint",
    {
      title: "Update a sprint",
      description: "Rename a sprint, change its status (planned / active / completed), or its dates.",
      input: {
        sprint: z.string().min(1).describe("Sprint name, id, or 'active'"),
        name: z.string().min(1).max(120).optional(),
        status: z.enum(SPRINT_STATUSES).optional(),
        start: z.string().optional(),
        end: z.string().optional(),
      },
      kind: "write",
      idempotent: true,
    },
    async (a) => {
      const s = await resolveSprint(a.sprint);
      if (a.name) check(await renameSprint(s.id, a.name));
      if (a.status) check(await setSprintStatus(s.id, a.status));
      if (a.start !== undefined || a.end !== undefined) {
        const cur = await prisma.sprint.findUniqueOrThrow({ where: { id: s.id }, select: { startDate: true, endDate: true } });
        check(
          await setSprintDates(
            s.id,
            a.start !== undefined ? parseDate(a.start) : (cur.startDate?.toISOString() ?? null),
            a.end !== undefined ? parseDate(a.end) : (cur.endDate?.toISOString() ?? null),
          ),
        );
      }
      return { ok: true, sprint: s.id };
    },
  );
}
