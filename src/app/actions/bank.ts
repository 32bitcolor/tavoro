"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { getAssessmentItemForUser, getBankItemForUser, getProjectForUser } from "@/lib/authz";
import { positionBetween } from "@/lib/ordering";
import { ASSESSMENT_ITEM_TYPES, BLOOM_LEVELS } from "@/lib/methodology";
import { BANK_KINDS, BANK_PROMPT_MAX } from "@/lib/bank";
import { Role } from "@/generated/prisma/client";

// The question bank (docs/CONTENT-LIFECYCLE-REUSE.md, phase 4): reusable question stems
// and scenario patterns. Items are COPIED into a project's assessment items (locked
// decision 3) and keep a pointer back for "where is this used". Any member can add,
// edit, label, archive and copy; deleting is for the creator, admins and managers.

const Fields = z.object({
  prompt: z.string().trim().min(1, "Write the question or scenario.").max(BANK_PROMPT_MAX, `Keep it under ${BANK_PROMPT_MAX} characters; put detail in the notes.`),
  kind: z.enum(BANK_KINDS),
  itemType: z.enum(ASSESSMENT_ITEM_TYPES),
  bloomLevel: z.enum(BLOOM_LEVELS).nullable(),
  notes: z.string().trim().max(5000).nullable(),
});
export type BankFields = z.input<typeof Fields>;

const emptyToNull = (input: Partial<BankFields>) =>
  Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === "" ? null : v])) as Partial<BankFields>;
const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Check the details and try again.";

function touched(id?: string, projectIds: string[] = []) {
  revalidatePath("/bank");
  if (id) revalidatePath(`/bank/${id}`);
  for (const p of projectIds) revalidatePath(`/projects/${p}`);
}

async function bankHere(id: string) {
  const [item, membership] = await Promise.all([getBankItemForUser(id), getActiveMembership()]);
  if (!item || !membership || item.workspaceId !== membership.workspaceId) return null;
  return { item, membership };
}

export async function createBankItem(input: Partial<BankFields> & { prompt: string }) {
  const membership = await getActiveMembership();
  if (!membership) return { error: "Not signed in." };
  const parsed = Fields.partial().required({ prompt: true }).safeParse(emptyToNull(input));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const d = parsed.data;
  const item = await prisma.bankItem.create({
    data: {
      ...d,
      // A scenario is assessed as one, so its type follows unless one was chosen.
      itemType: d.itemType ?? (d.kind === "scenario" ? "scenario" : "multiple_choice"),
      workspaceId: membership.workspaceId,
      createdById: membership.userId,
    },
    select: { id: true },
  });
  touched(item.id);
  return { id: item.id };
}

export async function updateBankItem(id: string, patch: Partial<BankFields>) {
  if (!(await bankHere(id))) return { error: "Bank item not found." };
  const parsed = Fields.partial().safeParse(emptyToNull(patch));
  if (!parsed.success) return { error: firstError(parsed.error) };
  await prisma.bankItem.update({ where: { id }, data: parsed.data });
  touched(id);
  return { ok: true as const };
}

export async function setBankItemLabels(id: string, labelIds: string[]) {
  const here = await bankHere(id);
  if (!here) return { error: "Bank item not found." };
  const ids = [...new Set(labelIds)].slice(0, 50);
  const valid = await prisma.label.findMany({ where: { id: { in: ids }, workspaceId: here.item.workspaceId }, select: { id: true } });
  await prisma.$transaction([
    prisma.bankItemLabel.deleteMany({ where: { bankItemId: id } }),
    prisma.bankItemLabel.createMany({ data: valid.map((l) => ({ bankItemId: id, labelId: l.id })) }),
  ]);
  touched(id);
  return { ok: true as const };
}

export async function setBankItemArchived(id: string, archived: boolean) {
  if (!(await bankHere(id))) return { error: "Bank item not found." };
  await prisma.bankItem.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
  touched(id);
  return { ok: true as const };
}

/** Deleting a bank item keeps every copy (their pointer back is cleared). */
export async function deleteBankItem(id: string) {
  const here = await bankHere(id);
  if (!here) return { error: "Bank item not found." };
  const { item, membership } = here;
  const manager = membership.role === Role.ADMIN || membership.role === Role.MANAGER;
  if (!manager && item.createdById !== membership.userId) {
    return { error: "Only the person who added it, or an admin or manager, can delete a bank item. Archive it instead." };
  }
  const copies = await prisma.assessmentItem.findMany({ where: { sourceBankItemId: id }, select: { projectId: true } });
  await prisma.bankItem.delete({ where: { id } });
  touched(undefined, [...new Set(copies.map((c) => c.projectId))]);
  return { ok: true as const };
}

/** Copy a bank item into a project as a new assessment item (at the end of its list).
 *  The copy is independent: editing either side never changes the other. */
export async function copyBankItemToProject(bankItemId: string, projectId: string) {
  const [here, project] = await Promise.all([bankHere(bankItemId), getProjectForUser(projectId)]);
  if (!here || !project || project.workspaceId !== here.item.workspaceId) return { error: "Bank item or project not found." };
  const archived = await prisma.bankItem.findUnique({ where: { id: bankItemId }, select: { archivedAt: true } });
  if (archived?.archivedAt) return { error: "This bank item is archived. Restore it before reusing it." };
  const last = await prisma.assessmentItem.findFirst({ where: { projectId }, orderBy: { position: "desc" }, select: { position: true } });
  const item = await prisma.assessmentItem.create({
    data: {
      projectId,
      prompt: here.item.prompt,
      itemType: here.item.itemType,
      position: positionBetween(last?.position ?? null, null),
      sourceBankItemId: bankItemId,
    },
    select: { id: true, prompt: true, itemType: true, position: true, sourceBankItemId: true },
  });
  touched(bankItemId, [projectId]);
  return { item };
}

/** Put a project's assessment item into the bank so other projects can reuse it. The
 *  item becomes a copy of the new bank entry. Its level comes from the objectives it
 *  assesses when they agree. An item already from the bank returns that entry. */
export async function saveAssessmentItemToBank(assessmentItemId: string) {
  const access = await getAssessmentItemForUser(assessmentItemId);
  const membership = await getActiveMembership();
  if (!access || !membership) return { error: "Item not found." };
  const it = await prisma.assessmentItem.findUniqueOrThrow({
    where: { id: assessmentItemId },
    select: {
      prompt: true,
      itemType: true,
      sourceBankItemId: true,
      project: { select: { workspaceId: true } },
      objectives: { select: { objective: { select: { bloomLevel: true } } } },
    },
  });
  if (it.project.workspaceId !== membership.workspaceId) return { error: "Switch to this project's workspace first." };
  if (it.sourceBankItemId) return { id: it.sourceBankItemId, existing: true };
  const levels = [...new Set(it.objectives.map((o) => o.objective.bloomLevel))];
  const bloom = levels.length === 1 && (BLOOM_LEVELS as readonly string[]).includes(levels[0]) ? levels[0] : null;
  const prompt = it.prompt.trim().slice(0, BANK_PROMPT_MAX);
  if (!prompt) return { error: "Write the question first." };
  const bank = await prisma.bankItem.create({
    data: {
      workspaceId: membership.workspaceId,
      kind: it.itemType === "scenario" ? "scenario" : "question",
      prompt,
      itemType: (ASSESSMENT_ITEM_TYPES as readonly string[]).includes(it.itemType) ? it.itemType : "other",
      bloomLevel: bloom,
      createdById: membership.userId,
    },
    select: { id: true },
  });
  await prisma.assessmentItem.update({ where: { id: assessmentItemId }, data: { sourceBankItemId: bank.id } });
  touched(bank.id, [access.projectId]);
  return { id: bank.id, existing: false };
}
