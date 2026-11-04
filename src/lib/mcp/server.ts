import "server-only";
import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { boardVisibilityWhere, projectVisibilityWhere, storyboardVisibilityWhere, whiteboardVisibilityWhere } from "@/lib/authz";
import { principal } from "@/lib/mcp/util";
import { registerWorkspaceTools } from "@/lib/mcp/tools/workspace";
import { loadBoard, loadCard, registerCardTools } from "@/lib/mcp/tools/cards";
import { loadProject, registerProjectTools } from "@/lib/mcp/tools/projects";
import { loadStoryboard, registerStoryboardTools } from "@/lib/mcp/tools/storyboards";
import { loadRound, registerReviewTools } from "@/lib/mcp/tools/reviews";
import { registerPlanningTools } from "@/lib/mcp/tools/planning";
import { loadWhiteboard, registerWhiteboardTools } from "@/lib/mcp/tools/whiteboards";
import { registerDocumentTools } from "@/lib/mcp/documents";
import { registerContentTools } from "@/lib/mcp/tools/content";

// Tavoro's MCP server (docs/MCP.md): tools for reading and changing the workspace,
// resources for reading one thing by URI, and prompts for common ID workflows. Built
// fresh per request, inside runAsPrincipal(), so every tool runs as the token's user.

const INSTRUCTIONS = `Tavoro is an instructional-design team workspace: projects (ADDIE/SAM phases, deliverables, milestones, learning objectives), boards of cards, storyboards (screens with on-screen text, narration, visuals, interaction and developer notes), whiteboards (Excalidraw canvases you can read and draw on as shapes, notes, frames and arrows), SME review rounds with pinned comments, intake requests and sprints.

Start with get_workspace to learn who you are acting as, your access level, and the members, statuses, labels and sprints other tools accept. Use search to find things by name; fetch returns any result as a full Markdown document, and the get_* tools return structured detail. Cards can be referred to by key (e.g. SEC-12). Rich text (descriptions, comments, storyboard fields) is Markdown in both directions. Dates are YYYY-MM-DD.

Everything you do is done as this user and shows up in the app under their name; reviewers and assignees may be emailed. Confirm with the user before deleting anything or starting a review round.`;

function json(uri: URL, data: unknown) {
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
}

function registerResources(server: McpServer) {
  const ws = () => principal().workspaceId;

  server.registerResource(
    "project",
    new ResourceTemplate("tavoro://project/{id}", {
      list: async () => ({
        resources: (
          await prisma.project.findMany({
            where: { workspaceId: ws(), status: { not: "completed" }, ...(await projectVisibilityWhere()) },
            orderBy: { updatedAt: "desc" },
            take: 50,
            select: { id: true, name: true },
          })
        ).map((p) => ({ uri: `tavoro://project/${p.id}`, name: p.name, mimeType: "application/json" })),
      }),
    }),
    { title: "Project", description: "A project with phases, deliverables, milestones and objectives", mimeType: "application/json" },
    async (uri, { id }) => json(uri, await loadProject(String(id))),
  );

  server.registerResource(
    "board",
    new ResourceTemplate("tavoro://board/{id}", {
      list: async () => ({
        resources: (
          await prisma.board.findMany({ where: { workspaceId: ws(), ...(await boardVisibilityWhere()) }, orderBy: { name: "asc" }, take: 50, select: { id: true, name: true } })
        ).map((b) => ({ uri: `tavoro://board/${b.id}`, name: b.name, mimeType: "application/json" })),
      }),
    }),
    { title: "Board", description: "A board's columns and cards", mimeType: "application/json" },
    async (uri, { id }) => json(uri, await loadBoard(String(id), true)),
  );

  server.registerResource(
    "storyboard",
    new ResourceTemplate("tavoro://storyboard/{id}", {
      list: async () => ({
        resources: (
          await prisma.storyboard.findMany({ where: { workspaceId: ws(), ...(await storyboardVisibilityWhere()) }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, title: true } })
        ).map((s) => ({ uri: `tavoro://storyboard/${s.id}`, name: s.title, mimeType: "application/json" })),
      }),
    }),
    { title: "Storyboard", description: "A storyboard, screen by screen, fields in Markdown", mimeType: "application/json" },
    async (uri, { id }) => json(uri, await loadStoryboard(String(id))),
  );

  server.registerResource(
    "whiteboard",
    new ResourceTemplate("tavoro://whiteboard/{id}", {
      list: async () => ({
        resources: (
          await prisma.whiteboard.findMany({ where: { workspaceId: ws(), ...(await whiteboardVisibilityWhere()) }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, title: true } })
        ).map((w) => ({ uri: `tavoro://whiteboard/${w.id}`, name: w.title, mimeType: "application/json" })),
      }),
    }),
    { title: "Whiteboard", description: "A whiteboard's items and connections", mimeType: "application/json" },
    async (uri, { id }) => json(uri, await loadWhiteboard(String(id))),
  );

  server.registerResource(
    "card",
    new ResourceTemplate("tavoro://card/{ref}", { list: undefined }),
    { title: "Card", description: "A card by id or key (tavoro://card/SEC-12)", mimeType: "application/json" },
    async (uri, { ref }) => json(uri, await loadCard(decodeURIComponent(String(ref)))),
  );

  server.registerResource(
    "review-round",
    new ResourceTemplate("tavoro://review-round/{id}", {
      list: async () => ({
        resources: (
          await prisma.reviewRound.findMany({
            where: { outcome: null, deliverable: { project: { workspaceId: ws(), ...(await projectVisibilityWhere()) } } },
            orderBy: { createdAt: "desc" },
            take: 50,
            select: { id: true, number: true, deliverable: { select: { name: true } } },
          })
        ).map((r) => ({ uri: `tavoro://review-round/${r.id}`, name: `${r.deliverable.name} · round ${r.number}`, mimeType: "application/json" })),
      }),
    }),
    { title: "Review round", description: "A review round with decisions, comment threads, and the storyboard as reviewed", mimeType: "application/json" },
    async (uri, { id }) => json(uri, await loadRound(String(id), true)),
  );
}

const user = (text: string) => ({ role: "user" as const, content: { type: "text" as const, text } });

function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "status_report",
    {
      title: "Project status report",
      description: "A stakeholder-ready status update for one project: progress by phase, deliverables and reviews, risks, and next steps.",
      argsSchema: { project_id: z.string().describe("Project id (use list_projects)") },
    },
    async ({ project_id }) => {
      const project = await loadProject(project_id);
      return {
        messages: [
          user(
            `Write a concise weekly status report for the project below, for stakeholders who don't use Tavoro.\n\nCover: overall status in one line; phase progress; each deliverable's state and where its review stands (call get_review_round for open rounds if you need the comments); milestones due in the next two weeks or overdue; risks and blockers (overdue items, changes requested, gaps in objective coverage); next steps with owners. Keep it under 400 words, plain language, with links.\n\nProject data:\n${JSON.stringify(project, null, 2)}`,
          ),
        ],
      };
    },
  );

  server.registerPrompt(
    "summarize_feedback",
    {
      title: "Summarize review feedback",
      description: "Group a deliverable's open review comments into themes, propose a response to each, and offer to send them to the board.",
      argsSchema: { deliverable_id: z.string().describe("Deliverable id") },
    },
    async ({ deliverable_id }) => {
      const rounds = await prisma.reviewRound.findMany({ where: { deliverableId: deliverable_id }, orderBy: { number: "desc" }, take: 3, select: { id: true } });
      const data = await Promise.all(rounds.map((r) => loadRound(r.id, false)));
      return {
        messages: [
          user(
            `Here is the review feedback on this deliverable (latest rounds first). Summarize the OPEN comments: group them into themes, say which reviewer raised each and where it's pinned, flag anything contradictory between reviewers, and propose a concrete change or a short reply for each. Then ask me whether to send them to the board as cards (send_comments_to_board) or resolve any as won't fix (set_review_comment_status). Don't change anything until I say so.\n\n${JSON.stringify(data, null, 2)}`,
          ),
        ],
      };
    },
  );

  server.registerPrompt(
    "draft_storyboard",
    {
      title: "Draft storyboard screens",
      description: "Draft new screens for a storyboard from a brief, aligned to the project's learning objectives.",
      argsSchema: { storyboard_id: z.string(), brief: z.string().describe("What this section should cover, for whom, and roughly how many screens") },
    },
    async ({ storyboard_id, brief }) => {
      const sb = await loadStoryboard(storyboard_id);
      const project = sb.deliverable ? await loadProject(sb.deliverable.project.id).catch(() => null) : null;
      return {
        messages: [
          user(
            `Draft storyboard screens for this brief: "${brief}".\n\nFor each screen give a title, a type (intro, content, video, knowledge_check, interaction, assessment, summary), on-screen text, narration, visuals, and interaction notes, written for adult learners: short, concrete, scenario-led. Tie screens to the learning objectives below where they fit. Show me the draft first; when I approve, add them with add_screens and link objectives with update_screen.\n\nCurrent storyboard:\n${JSON.stringify(sb, null, 2)}${project ? `\n\nProject objectives:\n${JSON.stringify(project.objectives, null, 2)}` : ""}`,
          ),
        ],
      };
    },
  );

  server.registerPrompt(
    "triage_intake",
    {
      title: "Triage new intake requests",
      description: "Score and recommend a decision for each untriaged intake request.",
      argsSchema: {},
    },
    async () => {
      const requests = await prisma.intakeRequest.findMany({
        where: { workspaceId: principal().workspaceId, status: { in: ["submitted", "triaging"] } },
        orderBy: { createdAt: "asc" },
        select: { number: true, title: true, description: true, targetAudience: true, targetDate: true, impactScore: true, effortScore: true, requesterName: true },
      });
      return {
        messages: [
          user(
            `Triage these training requests. For each, suggest impact (1–5) and effort (1–5) with a one-line reason, whether training is actually the right fix (or a job aid, a process change, or nothing), and a recommendation: approve, reject (with a kind reason for the requester), or ask a question first. Present them as a table. Apply the scores and decisions with triage_intake only after I confirm.\n\n${JSON.stringify(requests, null, 2)}`,
          ),
        ],
      };
    },
  );

  server.registerPrompt(
    "plan_sprint",
    {
      title: "Plan the next sprint",
      description: "Propose which cards go into a sprint, based on due dates, review status and who's assigned.",
      argsSchema: { sprint: z.string().describe("Sprint name or id") },
    },
    async ({ sprint }) => ({
      messages: [
        user(
          `Help me plan the sprint "${sprint}". Use get_workspace for the sprints and members, get_sprint for what's already in it, get_my_work and list_boards/get_board for candidates (open cards with due dates in or near the sprint, cards blocked on review feedback, unassigned work). Propose a balanced set of cards per person with a short rationale and flag anything at risk. After I agree, add them with update_card (sprint).`,
        ),
      ],
    }),
  );
}

export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: "tavoro", title: "Tavoro", version: "1.0.0" },
    { instructions: INSTRUCTIONS, capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  registerWorkspaceTools(server);
  registerDocumentTools(server);
  registerCardTools(server);
  registerProjectTools(server);
  registerStoryboardTools(server);
  registerReviewTools(server);
  registerPlanningTools(server);
  registerWhiteboardTools(server);
  registerContentTools(server);
  registerResources(server);
  registerPrompts(server);
  return server;
}
