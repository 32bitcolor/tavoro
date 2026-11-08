import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { getProjectForUser, projectVisibilityWhere } from "@/lib/authz";
import { createProjectForWorkspace } from "@/lib/projects";
import {
  ASSESSMENT_ITEM_TYPES,
  BLOOM_LEVELS,
  DELIVERABLE_STATUSES,
  DELIVERABLE_TYPES,
  PHASE_STATUSES,
  PROJECT_STATUSES,
} from "@/lib/methodology";
import {
  createPhase,
  deleteProject,
  renamePhase,
  renameProject,
  setPhaseDates,
  setPhaseStatus,
  setProjectStatus,
  updateProjectDescription,
} from "@/app/actions/projects";
import {
  createDeliverable,
  createMilestone,
  linkDeliverableCard,
  renameDeliverable,
  setDeliverablePhase,
  setDeliverableStatus,
  setDeliverableType,
  setMilestoneDue,
  toggleMilestone,
} from "@/app/actions/deliverables";
import { createAssessmentItem, createObjective, toggleItemObjective } from "@/app/actions/objectives";
import { addTimeEntry } from "@/app/actions/time";
import { check, day, link, parseDate, principal, resolveCardId, tool, ToolError } from "@/lib/mcp/util";

export async function loadProject(projectId: string) {
  if (!(await getProjectForUser(projectId))) throw new ToolError("Project not found, or you can't see it.");
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      methodology: true,
      status: true,
      sprintsEnabled: true,
      createdAt: true,
      phases: { orderBy: { position: "asc" }, select: { id: true, name: true, status: true, startDate: true, endDate: true } },
      deliverables: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          phase: { select: { name: true } },
          storyboard: { select: { id: true, title: true } },
          card: { select: { id: true, title: true } },
          reviewRounds: {
            orderBy: { number: "desc" },
            take: 1,
            select: {
              id: true,
              number: true,
              outcome: true,
              dueDate: true,
              _count: { select: { comments: { where: { parentId: null, status: "open" } } } },
            },
          },
        },
      },
      milestones: { orderBy: { position: "asc" }, select: { id: true, name: true, dueDate: true, completedAt: true } },
      objectives: {
        orderBy: { position: "asc" },
        select: { id: true, text: true, bloomLevel: true, _count: { select: { screens: true, assessments: true } } },
      },
      assessmentItems: { orderBy: { position: "asc" }, select: { id: true, prompt: true, itemType: true, sourceBankItemId: true, objectives: { select: { objectiveId: true } } } },
      boards: { select: { id: true, name: true } },
      timeEntries: { select: { minutes: true } },
    },
  });
  return {
    id: p.id,
    name: p.name,
    url: link(`/projects/${p.id}`),
    description: p.description,
    methodology: p.methodology,
    status: p.status,
    sprintsEnabled: p.sprintsEnabled,
    phases: p.phases.map((x) => ({ ...x, startDate: day(x.startDate), endDate: day(x.endDate) })),
    deliverables: p.deliverables.map((d) => {
      const r = d.reviewRounds[0];
      return {
        id: d.id,
        name: d.name,
        type: d.type,
        status: d.status,
        phase: d.phase?.name ?? null,
        storyboard: d.storyboard,
        card: d.card,
        latestReview: r
          ? { roundId: r.id, round: r.number, outcome: r.outcome ?? "in_review", due: day(r.dueDate), openComments: r._count.comments, url: link(`/reviews/${r.id}`) }
          : null,
      };
    }),
    milestones: p.milestones.map((m) => ({ id: m.id, name: m.name, due: day(m.dueDate), completed: !!m.completedAt })),
    objectives: p.objectives.map((o) => ({ id: o.id, text: o.text, bloomLevel: o.bloomLevel, taughtOnScreens: o._count.screens, assessedByItems: o._count.assessments })),
    assessmentItems: p.assessmentItems.map((i) => ({ id: i.id, prompt: i.prompt, type: i.itemType, objectiveIds: i.objectives.map((o) => o.objectiveId), fromBankItem: i.sourceBankItemId })),
    boards: p.boards.map((b) => ({ ...b, url: link(`/boards/${b.id}`) })),
    hoursLogged: Math.round((p.timeEntries.reduce((n, t) => n + t.minutes, 0) / 60) * 10) / 10,
  };
}

async function projectOfDeliverable(deliverableId: string) {
  const d = await prisma.deliverable.findUnique({ where: { id: deliverableId }, select: { projectId: true } });
  if (!d) throw new ToolError("Deliverable not found.");
  return d.projectId;
}

export function registerProjectTools(server: McpServer) {
  tool(
    server,
    "list_projects",
    {
      title: "List projects",
      description: "Projects you can see, with methodology, status, current phase and deliverable counts.",
      input: { status: z.enum(PROJECT_STATUSES).optional() },
      kind: "read",
    },
    async ({ status }) => {
      const projects = await prisma.project.findMany({
        where: { workspaceId: principal().workspaceId, ...(status ? { status } : {}), ...(await projectVisibilityWhere()) },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          methodology: true,
          status: true,
          phases: { orderBy: { position: "asc" }, select: { name: true, status: true } },
          _count: { select: { deliverables: true } },
        },
      });
      return projects.map((p) => ({
        id: p.id,
        name: p.name,
        methodology: p.methodology,
        status: p.status,
        currentPhase: p.phases.find((x) => x.status === "in_progress")?.name ?? p.phases.find((x) => x.status !== "done")?.name ?? null,
        phasesDone: `${p.phases.filter((x) => x.status === "done").length}/${p.phases.length}`,
        deliverables: p._count.deliverables,
        url: link(`/projects/${p.id}`),
      }));
    },
  );

  tool(
    server,
    "get_project",
    {
      title: "Get a project",
      description:
        "A project in full: phases, deliverables (with their storyboard, card and latest review round), milestones, learning objectives with coverage, assessment items, boards and hours logged.",
      input: { project_id: z.string().min(1) },
      kind: "read",
    },
    ({ project_id }) => loadProject(project_id),
  );

  tool(
    server,
    "create_project",
    {
      title: "Create a project",
      description: "A new project; its phases come from the methodology (ADDIE, SAM or CUSTOM).",
      input: {
        name: z.string().min(1).max(120),
        methodology: z.enum(["ADDIE", "SAM", "CUSTOM"]).default("ADDIE"),
        description: z.string().max(5000).optional(),
      },
      kind: "write",
    },
    async ({ name, methodology, description }) => {
      const project = await createProjectForWorkspace(principal().workspaceId, name.trim(), methodology);
      if (description) check(await updateProjectDescription(project.id, description));
      return loadProject(project.id);
    },
  );

  tool(
    server,
    "update_project",
    {
      title: "Update a project",
      description: "Rename a project, replace its description, or set its status.",
      input: {
        project_id: z.string().min(1),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(5000).optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
      },
      kind: "write",
      idempotent: true,
    },
    async (a) => {
      if (a.name) check(await renameProject(a.project_id, a.name));
      if (a.description !== undefined) check(await updateProjectDescription(a.project_id, a.description));
      if (a.status) check(await setProjectStatus(a.project_id, a.status));
      return loadProject(a.project_id);
    },
  );

  tool(
    server,
    "delete_project",
    {
      title: "Delete a project",
      description: "Permanently delete a project with its phases, deliverables, reviews, milestones and objectives. Its boards are kept but detached. Cannot be undone.",
      input: { project_id: z.string().min(1) },
      kind: "destructive",
    },
    async ({ project_id }) => {
      check(await deleteProject(project_id));
      return { ok: true, deleted: project_id };
    },
  );

  tool(
    server,
    "add_phase",
    { title: "Add a phase", description: "Add a phase to the end of a project.", input: { project_id: z.string().min(1), name: z.string().min(1).max(120) }, kind: "write" },
    async ({ project_id, name }) => {
      check(await createPhase(project_id, name));
      return loadProject(project_id);
    },
  );

  tool(
    server,
    "update_phase",
    {
      title: "Update a phase",
      description: "Rename a phase, set its status, or set its start/end dates (empty string clears a date).",
      input: {
        phase_id: z.string().min(1),
        name: z.string().min(1).max(120).optional(),
        status: z.enum(PHASE_STATUSES).optional(),
        start: z.string().optional().describe("YYYY-MM-DD"),
        end: z.string().optional().describe("YYYY-MM-DD"),
      },
      kind: "write",
      idempotent: true,
    },
    async (a) => {
      const phase = await prisma.phase.findUnique({ where: { id: a.phase_id }, select: { projectId: true, startDate: true, endDate: true } });
      if (!phase || !(await getProjectForUser(phase.projectId))) throw new ToolError("Phase not found.");
      if (a.name) check(await renamePhase(a.phase_id, a.name));
      if (a.status) check(await setPhaseStatus(a.phase_id, a.status));
      if (a.start !== undefined || a.end !== undefined) {
        const start = a.start !== undefined ? parseDate(a.start) : phase.startDate?.toISOString() ?? null;
        const end = a.end !== undefined ? parseDate(a.end) : phase.endDate?.toISOString() ?? null;
        check(await setPhaseDates(a.phase_id, start, end));
      }
      return loadProject(phase.projectId);
    },
  );

  tool(
    server,
    "create_deliverable",
    {
      title: "Add a deliverable",
      description: "Add a deliverable (storyboard, assessment, job aid, video, document…) to a project, optionally in a phase.",
      input: {
        project_id: z.string().min(1),
        name: z.string().min(1).max(200),
        type: z.enum(DELIVERABLE_TYPES).default("other"),
        phase_id: z.string().optional(),
      },
      kind: "write",
    },
    async ({ project_id, name, type, phase_id }) => {
      const before = new Set((await prisma.deliverable.findMany({ where: { projectId: project_id }, select: { id: true } })).map((d) => d.id));
      check(await createDeliverable(project_id, name, type));
      const created = await prisma.deliverable.findFirst({ where: { projectId: project_id, id: { notIn: [...before] } }, select: { id: true } });
      if (created && phase_id) check(await setDeliverablePhase(created.id, phase_id));
      return { deliverableId: created?.id, project: await loadProject(project_id) };
    },
  );

  tool(
    server,
    "update_deliverable",
    {
      title: "Update a deliverable",
      description: "Rename a deliverable or change its type, status, phase (empty string clears) or linked card (id or key; empty string unlinks).",
      input: {
        deliverable_id: z.string().min(1),
        name: z.string().min(1).max(200).optional(),
        type: z.enum(DELIVERABLE_TYPES).optional(),
        status: z.enum(DELIVERABLE_STATUSES).optional(),
        phase_id: z.string().optional(),
        card: z.string().optional(),
      },
      kind: "write",
      idempotent: true,
    },
    async (a) => {
      const projectId = await projectOfDeliverable(a.deliverable_id);
      if (a.name) check(await renameDeliverable(a.deliverable_id, a.name));
      if (a.type) check(await setDeliverableType(a.deliverable_id, a.type));
      if (a.status) check(await setDeliverableStatus(a.deliverable_id, a.status));
      if (a.phase_id !== undefined) check(await setDeliverablePhase(a.deliverable_id, a.phase_id || null));
      if (a.card !== undefined) check(await linkDeliverableCard(a.deliverable_id, a.card ? await resolveCardId(a.card) : null));
      return loadProject(projectId);
    },
  );

  tool(
    server,
    "create_milestone",
    {
      title: "Add a milestone",
      description: "Add a milestone to a project, with an optional due date.",
      input: { project_id: z.string().min(1), name: z.string().min(1).max(200), due: z.string().optional().describe("YYYY-MM-DD") },
      kind: "write",
    },
    async ({ project_id, name, due }) => {
      check(await createMilestone(project_id, name, parseDate(due)));
      return loadProject(project_id);
    },
  );

  tool(
    server,
    "update_milestone",
    {
      title: "Update a milestone",
      description: "Mark a milestone complete or not, or change its due date (empty string clears it).",
      input: { milestone_id: z.string().min(1), completed: z.boolean().optional(), due: z.string().optional() },
      kind: "write",
      idempotent: true,
    },
    async ({ milestone_id, completed, due }) => {
      const m = await prisma.milestone.findUnique({ where: { id: milestone_id }, select: { projectId: true } });
      if (!m) throw new ToolError("Milestone not found.");
      if (completed !== undefined) check(await toggleMilestone(milestone_id, completed));
      if (due !== undefined) check(await setMilestoneDue(milestone_id, parseDate(due)));
      return loadProject(m.projectId);
    },
  );

  tool(
    server,
    "add_objective",
    {
      title: "Add a learning objective",
      description: "Add a measurable learning objective to a project, at a Bloom's level.",
      input: { project_id: z.string().min(1), text: z.string().min(1).max(1000), bloom_level: z.enum(BLOOM_LEVELS).default("understand") },
      kind: "write",
    },
    async ({ project_id, text, bloom_level }) => {
      check(await createObjective(project_id, text, bloom_level));
      return loadProject(project_id);
    },
  );

  tool(
    server,
    "add_assessment_item",
    {
      title: "Add an assessment item",
      description: "Add an assessment item (question) to a project, optionally mapped to the objectives it assesses.",
      input: {
        project_id: z.string().min(1),
        prompt: z.string().min(1).max(4000),
        item_type: z.enum(ASSESSMENT_ITEM_TYPES).default("multiple_choice"),
        objective_ids: z.array(z.string()).max(20).optional(),
      },
      kind: "write",
    },
    async ({ project_id, prompt, item_type, objective_ids }) => {
      const before = new Set((await prisma.assessmentItem.findMany({ where: { projectId: project_id }, select: { id: true } })).map((i) => i.id));
      check(await createAssessmentItem(project_id, prompt, item_type));
      const item = await prisma.assessmentItem.findFirst({ where: { projectId: project_id, id: { notIn: [...before] } }, select: { id: true } });
      for (const o of objective_ids ?? []) if (item) check(await toggleItemObjective(item.id, o, true));
      return loadProject(project_id);
    },
  );

  tool(
    server,
    "log_time",
    {
      title: "Log time",
      description: "Log time you spent on a project (optionally on one deliverable).",
      input: {
        project_id: z.string().min(1),
        minutes: z.number().int().min(1).max(1440),
        date: z.string().optional().describe("YYYY-MM-DD; defaults to today"),
        note: z.string().max(500).optional(),
        deliverable_id: z.string().optional(),
      },
      kind: "write",
    },
    async (a) => {
      check(await addTimeEntry(a.project_id, a.deliverable_id ?? null, a.minutes, parseDate(a.date), a.note ?? ""));
      return { ok: true, logged: `${a.minutes} min`, project: a.project_id };
    },
  );
}
