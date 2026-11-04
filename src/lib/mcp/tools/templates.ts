import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProjectFromTemplate, createStoryboardFromTemplate, listTemplates, saveAsTemplate } from "@/app/actions/templates";
import { TEMPLATE_KINDS } from "@/lib/templates";
import { loadProject } from "@/lib/mcp/tools/projects";
import { loadStoryboard } from "@/lib/mcp/tools/storyboards";
import { check, link, tool } from "@/lib/mcp/util";

// Templates (docs/CONTENT-LIFECYCLE-REUSE.md, phase 3): reusable project skeletons and
// storyboards. Same server actions as the app.

export function registerTemplateTools(server: McpServer) {
  tool(
    server,
    "list_templates",
    {
      title: "List templates",
      description: "The workspace's project and storyboard templates, with what each contains. Use one with create_project_from_template or create_storyboard_from_template.",
      kind: "read",
      input: { kind: z.enum(TEMPLATE_KINDS).optional() },
    },
    async ({ kind }) => {
      const rows = await listTemplates(kind);
      return {
        templates: rows.map((t) => ({ id: t.id, kind: t.kind, name: t.name, description: t.description, contains: t.summary, savedBy: t.createdBy, updatedAt: t.updatedAt })),
        url: link("/templates"),
      };
    },
  );

  tool(
    server,
    "create_project_from_template",
    {
      title: "Create a project from a template",
      description:
        "A new project built from a project template: its phases, deliverables, milestones, storyboards, objectives, assessment items and boards with cards. Phase and milestone dates are placed relative to start_date (default today). Everything starts not started and unassigned.",
      kind: "write",
      input: {
        template_id: z.string().min(1).describe("From list_templates"),
        name: z.string().min(1).max(140),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
      },
    },
    async ({ template_id, name, start_date }) => {
      const res = check(await createProjectFromTemplate(template_id, name, start_date ?? null));
      return loadProject(res.id);
    },
  );

  tool(
    server,
    "create_storyboard_from_template",
    {
      title: "Create a storyboard from a template",
      description: "A new storyboard with the template's screens and their text. Pass deliverable_id to make it that deliverable's storyboard (it must not have one yet).",
      kind: "write",
      input: {
        template_id: z.string().min(1).describe("From list_templates"),
        title: z.string().min(1).max(180),
        deliverable_id: z.string().optional().describe("Deliverable id (from get_project)"),
      },
    },
    async ({ template_id, title, deliverable_id }) => {
      const res = check(await createStoryboardFromTemplate(template_id, title, deliverable_id ?? null));
      return loadStoryboard(res.storyboard.id);
    },
  );

  tool(
    server,
    "save_as_template",
    {
      title: "Save a project or storyboard as a template",
      description:
        "Snapshot a project's skeleton or a storyboard's screens as a reusable template everyone in the workspace can use. Pass replace_template_id to overwrite one of the same kind (only its creator or an admin/manager can).",
      kind: "write",
      input: {
        kind: z.enum(TEMPLATE_KINDS),
        source_id: z.string().min(1).describe("The project id or storyboard id"),
        name: z.string().min(1).max(140),
        description: z.string().max(2000).optional(),
        replace_template_id: z.string().optional(),
      },
    },
    async ({ kind, source_id, name, description, replace_template_id }) => {
      const res = check(await saveAsTemplate({ kind, sourceId: source_id, name, description: description ?? null, replaceId: replace_template_id ?? null }));
      const [t] = (await listTemplates(kind)).filter((x) => x.id === res.id);
      return { template: t ? { id: t.id, kind: t.kind, name: t.name, contains: t.summary } : { id: res.id }, replaced: res.replaced, url: link("/templates") };
    },
  );
}
