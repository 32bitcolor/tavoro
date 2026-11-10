import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { getStoryboardForUser, storyboardVisibilityWhere } from "@/lib/authz";
import { SCREEN_FIELDS, SCREEN_FIELD_LABEL } from "@/lib/review-anchor";
import { SCREEN_TYPES, STORYBOARD_STATUSES } from "@/lib/storyboard";
import {
  createScreen,
  createStoryboardForDeliverable,
  createStoryboardNamed,
  deleteScreen,
  moveScreen,
  renameScreen,
  renameStoryboard,
  setScreenType,
  setStoryboardStatus,
  updateScreenField,
  updateStoryboardDescription,
} from "@/app/actions/storyboards";
import { toggleScreenObjective } from "@/app/actions/objectives";
import { fromMarkdown, toMarkdown } from "@/lib/markdown";
import { check, link, principal, tool, ToolError } from "@/lib/mcp/util";
import { createCourseFromStoryboard, storyboardCourseState } from "@/lib/storyboard-course";

// Screen fields as tool arguments, in the words a designer uses.
const FIELD_ARGS = {
  on_screen_text: "onScreenText",
  narration: "narration",
  visuals: "visualNotes",
  interaction: "interactionNotes",
  developer_notes: "developerNotes",
} as const satisfies Record<string, (typeof SCREEN_FIELDS)[number]>;

const fieldsInput = z
  .object({
    on_screen_text: z.string().max(50000).optional(),
    narration: z.string().max(50000).optional(),
    visuals: z.string().max(50000).optional(),
    interaction: z.string().max(50000).optional(),
    developer_notes: z.string().max(50000).optional(),
  })
  .describe("Markdown per field; an empty string clears a field; leave a field out to keep it");

export async function loadStoryboard(storyboardId: string) {
  if (!(await getStoryboardForUser(storyboardId))) throw new ToolError("Storyboard not found, or you can't see it.");
  const sb = await prisma.storyboard.findUniqueOrThrow({
    where: { id: storyboardId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      deliverable: { select: { id: true, name: true, project: { select: { id: true, name: true } } } },
      screens: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          screenType: true,
          onScreenText: true,
          narration: true,
          visualNotes: true,
          interactionNotes: true,
          developerNotes: true,
          objectives: { select: { objective: { select: { id: true, text: true } } } },
        },
      },
    },
  });
  return {
    id: sb.id,
    title: sb.title,
    url: link(`/storyboards/${sb.id}`),
    status: sb.status,
    description: sb.description,
    deliverable: sb.deliverable,
    screens: sb.screens.map((s, i) => ({
      id: s.id,
      number: i + 1,
      title: s.title,
      type: s.screenType,
      ...Object.fromEntries(Object.entries(FIELD_ARGS).map(([arg, f]) => [arg, toMarkdown(s[f])])),
      objectives: s.objectives.map((o) => o.objective),
    })),
    ...(await courseOfStoryboard(sb.id)),
  };
}

/** The CourseForge course drafted from it (docs/SUITE.md, step 3), if any. */
async function courseOfStoryboard(id: string) {
  const st = await storyboardCourseState(id);
  return st?.course ? { course: { id: st.course.id, title: st.course.title, url: st.course.url, createdAt: st.course.at } } : {};
}

async function applyFields(screenId: string, fields: z.infer<typeof fieldsInput> | undefined) {
  for (const [arg, field] of Object.entries(FIELD_ARGS)) {
    const v = fields?.[arg as keyof typeof FIELD_ARGS];
    if (v !== undefined) check(await updateScreenField(screenId, field, fromMarkdown(v)));
  }
}

async function storyboardOfScreen(screenId: string) {
  const s = await prisma.screen.findUnique({ where: { id: screenId }, select: { storyboardId: true } });
  if (!s || !(await getStoryboardForUser(s.storyboardId))) throw new ToolError("Screen not found.");
  return s.storyboardId;
}

export function registerStoryboardTools(server: McpServer) {
  tool(
    server,
    "create_course_from_storyboard",
    {
      title: "Create a CourseForge course from a storyboard",
      description:
        "Make a first-draft course in the CourseForge connected to this workspace, owned by you: each screen becomes a lesson built from its on-screen text (knowledge checks join the screen before), the project's objectives go on the cover, and narration, visual, interaction and developer notes plus the project's assessment items become build notes (review comments in the course). The storyboard, and its deliverable's card if that has no course yet, are linked to the new course. Running it again makes another course. You need to have signed in to CourseForge with Tavoro once.",
      input: { storyboard_id: z.string().min(1) },
      kind: "write",
    },
    async ({ storyboard_id }) => {
      const r = await createCourseFromStoryboard(storyboard_id, principal().userId);
      if ("error" in r) throw new ToolError(r.error);
      return { course: { id: r.course.id, title: r.course.title, url: r.course.url, lessons: r.course.lessons }, buildNotes: r.notes, linkedCard: !!r.card };
    },
  );

  tool(
    server,
    "list_storyboards",
    { title: "List storyboards", description: "Storyboards you can see, with status, screen count and linked deliverable.", input: {}, kind: "read" },
    async () => {
      const sbs = await prisma.storyboard.findMany({
        where: { workspaceId: principal().workspaceId, ...(await storyboardVisibilityWhere()) },
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, status: true, deliverable: { select: { id: true, name: true } }, _count: { select: { screens: true } } },
      });
      return sbs.map((s) => ({ id: s.id, title: s.title, status: s.status, screens: s._count.screens, deliverable: s.deliverable, url: link(`/storyboards/${s.id}`) }));
    },
  );

  tool(
    server,
    "get_storyboard",
    {
      title: "Get a storyboard",
      description: `A storyboard screen by screen. Each screen has a type and Markdown fields: ${Object.keys(FIELD_ARGS).join(", ")} (${SCREEN_FIELDS.map((f) => SCREEN_FIELD_LABEL[f]).join(", ")} in the app), plus the objectives it teaches.`,
      input: { storyboard_id: z.string().min(1) },
      kind: "read",
    },
    ({ storyboard_id }) => loadStoryboard(storyboard_id),
  );

  tool(
    server,
    "create_storyboard",
    {
      title: "Create a storyboard",
      description:
        "A new storyboard. With deliverable_id it's created for (and linked to) that deliverable; if the deliverable already has one, that one is returned.",
      input: { title: z.string().min(1).max(200).optional(), deliverable_id: z.string().optional(), description: z.string().max(5000).optional() },
      kind: "write",
    },
    async ({ title, deliverable_id, description }) => {
      let id: string;
      if (deliverable_id) {
        id = check(await createStoryboardForDeliverable(deliverable_id)).storyboard!.id;
        if (title) check(await renameStoryboard(id, title));
      } else {
        if (!title) throw new ToolError("Give the storyboard a title (or a deliverable_id).");
        id = check(await createStoryboardNamed(title)).storyboard!.id;
      }
      if (description) check(await updateStoryboardDescription(id, description));
      return loadStoryboard(id);
    },
  );

  tool(
    server,
    "update_storyboard",
    {
      title: "Update a storyboard",
      description: "Rename a storyboard, replace its description, or set its status.",
      input: {
        storyboard_id: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(5000).optional(),
        status: z.enum(STORYBOARD_STATUSES).optional(),
      },
      kind: "write",
      idempotent: true,
    },
    async (a) => {
      if (a.title) check(await renameStoryboard(a.storyboard_id, a.title));
      if (a.description !== undefined) check(await updateStoryboardDescription(a.storyboard_id, a.description));
      if (a.status) check(await setStoryboardStatus(a.storyboard_id, a.status));
      return loadStoryboard(a.storyboard_id);
    },
  );

  tool(
    server,
    "add_screens",
    {
      title: "Add screens",
      description: "Append one or more screens to a storyboard, each with a type and Markdown fields. Optionally insert them at a 1-based position.",
      input: {
        storyboard_id: z.string().min(1),
        screens: z
          .array(z.object({ title: z.string().min(1).max(200), type: z.enum(SCREEN_TYPES).default("content"), fields: fieldsInput.optional() }))
          .min(1)
          .max(50),
        position: z.number().int().min(1).optional().describe("Insert the first new screen here (1 = first); default: at the end"),
      },
      kind: "write",
    },
    async ({ storyboard_id, screens, position }) => {
      let at = position ? position - 1 : null;
      for (const s of screens) {
        const { screen } = check(await createScreen(storyboard_id, s.title));
        if (!screen) continue;
        if (s.type !== "content") check(await setScreenType(screen.id, s.type));
        await applyFields(screen.id, s.fields);
        if (at != null) check(await moveScreen(screen.id, at++));
      }
      return loadStoryboard(storyboard_id);
    },
  );

  tool(
    server,
    "update_screen",
    {
      title: "Update a screen",
      description: "Change a screen's title, type, fields (Markdown) or position (1-based), and link or unlink the objectives it teaches.",
      input: {
        screen_id: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        type: z.enum(SCREEN_TYPES).optional(),
        fields: fieldsInput.optional(),
        position: z.number().int().min(1).optional(),
        add_objective_ids: z.array(z.string()).max(20).optional(),
        remove_objective_ids: z.array(z.string()).max(20).optional(),
      },
      kind: "write",
      idempotent: true,
    },
    async (a) => {
      const storyboardId = await storyboardOfScreen(a.screen_id);
      if (a.title) check(await renameScreen(a.screen_id, a.title));
      if (a.type) check(await setScreenType(a.screen_id, a.type));
      await applyFields(a.screen_id, a.fields);
      if (a.position) check(await moveScreen(a.screen_id, a.position - 1));
      for (const o of a.add_objective_ids ?? []) check(await toggleScreenObjective(a.screen_id, o, true));
      for (const o of a.remove_objective_ids ?? []) check(await toggleScreenObjective(a.screen_id, o, false));
      return loadStoryboard(storyboardId);
    },
  );

  tool(
    server,
    "delete_screen",
    { title: "Delete a screen", description: "Permanently delete a storyboard screen. Cannot be undone.", input: { screen_id: z.string().min(1) }, kind: "destructive" },
    async ({ screen_id }) => {
      const storyboardId = await storyboardOfScreen(screen_id);
      check(await deleteScreen(screen_id));
      return loadStoryboard(storyboardId);
    },
  );
}
