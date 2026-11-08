import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { getBankItemForUser, projectVisibilityWhere } from "@/lib/authz";
import {
  copyBankItemToProject,
  createBankItem,
  saveAssessmentItemToBank,
  setBankItemArchived,
  setBankItemLabels,
  updateBankItem,
  type BankFields,
} from "@/app/actions/bank";
import { BANK_SELECT, bankUsage, listBank, toBankRow, type BankRow } from "@/lib/bank-list";
import { BANK_KINDS, BANK_PROMPT_MAX } from "@/lib/bank";
import { ASSESSMENT_ITEM_TYPES, BLOOM_LEVELS } from "@/lib/methodology";
import { check, iso, link, principal, tool, ToolError } from "@/lib/mcp/util";

// The question bank (docs/CONTENT-LIFECYCLE-REUSE.md, phase 4): reusable question stems
// and scenario patterns, copied (never linked live) into projects' assessment items.

const bankRef = z.string().min(1).describe("Bank item id (from list_bank_items)");

function summary(b: BankRow) {
  return {
    id: b.id,
    kind: b.kind,
    prompt: b.prompt,
    type: b.itemType,
    bloomLevel: b.bloomLevel,
    archived: !!b.archivedAt,
    timesUsed: b.copies,
    labels: b.labels.map((l) => l.name),
    url: link(`/bank/${b.id}`),
  };
}

async function inWorkspace(id: string) {
  const b = await getBankItemForUser(id);
  if (!b || b.workspaceId !== principal().workspaceId) throw new ToolError("Bank item not found, or it's in another workspace.");
  return b;
}

async function loadBank(id: string) {
  await inWorkspace(id);
  const [row, usage] = await Promise.all([prisma.bankItem.findUniqueOrThrow({ where: { id }, select: BANK_SELECT }), bankUsage(id, await projectVisibilityWhere())]);
  const b = toBankRow(row);
  return {
    ...summary(b),
    notes: b.notes,
    addedBy: b.createdBy ? { name: b.createdBy.name, email: b.createdBy.email } : null,
    createdAt: iso(b.createdAt),
    updatedAt: iso(b.updatedAt),
    usedIn: usage.copies.map((c) => ({ assessmentItemId: c.id, project: { id: c.project.id, name: c.project.name, url: link(`/projects/${c.project.id}`) } })),
    copiesInProjectsYouCantSee: usage.hidden,
  };
}

async function labelIds(names: string[]): Promise<string[]> {
  const labels = await prisma.label.findMany({ where: { workspaceId: principal().workspaceId }, select: { id: true, name: true } });
  return names.map((n) => {
    const hit = labels.find((l) => l.name.toLowerCase() === n.trim().toLowerCase());
    if (!hit) throw new ToolError(`There's no label called "${n}". Existing labels: ${labels.map((l) => l.name).join(", ") || "none"}.`);
    return hit.id;
  });
}

const fields = {
  kind: z.enum(BANK_KINDS).optional(),
  type: z.enum(ASSESSMENT_ITEM_TYPES).optional().describe("The assessment item type it becomes in a project"),
  bloomLevel: z.enum(BLOOM_LEVELS).nullable().optional(),
  notes: z.string().max(5000).nullable().optional().describe("Answer and rationale, distractors, source policy: plain text, stays in the bank"),
  labels: z.array(z.string()).max(50).optional().describe("Workspace label names; replaces the item's labels"),
};

function toPatch(a: { kind?: string; type?: string; bloomLevel?: string | null; notes?: string | null }): Partial<BankFields> {
  return {
    ...(a.kind !== undefined ? { kind: a.kind as BankFields["kind"] } : {}),
    ...(a.type !== undefined ? { itemType: a.type as BankFields["itemType"] } : {}),
    ...(a.bloomLevel !== undefined ? { bloomLevel: a.bloomLevel as BankFields["bloomLevel"] } : {}),
    ...(a.notes !== undefined ? { notes: a.notes } : {}),
  };
}

export function registerBankTools(server: McpServer) {
  tool(
    server,
    "list_bank_items",
    {
      title: "List the question bank",
      description:
        "Reusable question stems and scenario patterns in the workspace's question bank, newest first, with how many times each has been copied into projects. Archived items are left out unless you ask for them.",
      kind: "read",
      input: {
        query: z.string().optional().describe("Only items whose prompt or notes contain this"),
        kind: z.enum(BANK_KINDS).optional(),
        type: z.enum(ASSESSMENT_ITEM_TYPES).optional(),
        bloomLevel: z.enum(BLOOM_LEVELS).optional(),
        label: z.string().optional().describe("Only items with this label (name)"),
        unused: z.boolean().optional().describe("Only items never copied into a project"),
        archived: z.boolean().optional(),
      },
    },
    async ({ query, kind, type, bloomLevel, label, unused, archived }) => {
      const labelId = label ? (await labelIds([label]))[0] : undefined;
      const rows = await listBank(principal().workspaceId, { q: query, kind, type, bloom: bloomLevel, labelId, unused: unused ? "1" : undefined, archived: archived ? "1" : undefined });
      return { items: rows.slice(0, 200).map(summary), total: rows.length };
    },
  );

  tool(
    server,
    "get_bank_item",
    { title: "Get a bank item", description: "One question-bank item in full: prompt, notes, labels, and the projects holding copies of it.", kind: "read", input: { item: bankRef } },
    async ({ item }) => loadBank(item),
  );

  tool(
    server,
    "create_bank_item",
    {
      title: "Add to the question bank",
      description: `Add a reusable question stem or scenario pattern (prompt up to ${BANK_PROMPT_MAX} characters; put the answer and detail in notes). To bank an existing project assessment item, use save_assessment_item_to_bank instead so it keeps the link.`,
      kind: "write",
      input: { prompt: z.string().min(1).max(BANK_PROMPT_MAX), ...fields },
    },
    async ({ prompt, labels, ...rest }) => {
      const ids = labels ? await labelIds(labels) : null;
      const res = check(await createBankItem({ prompt, ...toPatch(rest) }));
      if (ids) check(await setBankItemLabels(res.id, ids));
      return loadBank(res.id);
    },
  );

  tool(
    server,
    "update_bank_item",
    {
      title: "Update a bank item",
      description: "Change a question-bank item; only the fields you pass change. Copies already in projects are never changed.",
      kind: "write",
      idempotent: true,
      input: { item: bankRef, prompt: z.string().min(1).max(BANK_PROMPT_MAX).optional(), archived: z.boolean().optional(), ...fields },
    },
    async ({ item, prompt, labels, archived, ...rest }) => {
      await inWorkspace(item);
      const ids = labels ? await labelIds(labels) : null;
      const patch = { ...toPatch(rest), ...(prompt ? { prompt } : {}) };
      if (Object.keys(patch).length) check(await updateBankItem(item, patch));
      if (ids) check(await setBankItemLabels(item, ids));
      if (archived !== undefined) check(await setBankItemArchived(item, archived));
      return loadBank(item);
    },
  );

  tool(
    server,
    "copy_bank_item_to_project",
    {
      title: "Copy a bank item into a project",
      description:
        "Add a question-bank item to a project as a new assessment item (at the end). It's an independent copy that remembers its source. Link it to objectives afterwards with the project tools.",
      kind: "write",
      input: { item: bankRef, project_id: z.string().min(1).describe("Project id (from list_projects)") },
    },
    async ({ item, project_id }) => {
      await inWorkspace(item);
      const res = check(await copyBankItemToProject(item, project_id));
      return { assessmentItem: { id: res.item.id, prompt: res.item.prompt, type: res.item.itemType }, project: { id: project_id, url: link(`/projects/${project_id}`) }, bankItem: await loadBank(item) };
    },
  );

  tool(
    server,
    "save_assessment_item_to_bank",
    {
      title: "Save an assessment item to the bank",
      description: "Put one of a project's assessment items into the question bank so other projects can reuse it. Returns the existing entry if the item already came from the bank.",
      kind: "write",
      input: { assessment_item_id: z.string().min(1).describe("Assessment item id (from get_project)") },
    },
    async ({ assessment_item_id }) => {
      const res = check(await saveAssessmentItemToBank(assessment_item_id));
      return { ...(await loadBank(res.id)), alreadyInBank: res.existing };
    },
  );
}
