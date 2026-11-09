"use server";

import { revalidatePath } from "next/cache";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getCardForUser } from "@/lib/authz";
import { getActiveMembership, getCurrentUser } from "@/lib/dal";
import { recordActivity } from "@/lib/card-activity";
import {
  FIELD_TYPES,
  FieldName,
  OptionsSchema,
  asFieldType,
  asOptions,
  displayValue,
  fieldOnBoard,
  fromStored,
  toStored,
  type CustomFieldDef,
  type FieldValue,
} from "@/lib/custom-fields";

// Custom card fields (docs/JIRA-PARITY.md, phase 8). Admins define them in Settings →
// Cards & labels; anyone who can edit a card sets its values.

async function admin() {
  const m = await getActiveMembership();
  return m && m.role === Role.ADMIN ? m : null;
}

const FIELD_SELECT = { id: true, name: true, type: true, options: true, allBoards: true, boards: { select: { boardId: true } } } as const;
type Row = { id: string; name: string; type: string; options: unknown; allBoards: boolean; boards: { boardId: string }[] };
const toDef = (f: Row): CustomFieldDef => ({ id: f.id, name: f.name, type: asFieldType(f.type), options: asOptions(f.options), allBoards: f.allBoards, boardIds: f.boards.map((b) => b.boardId) });

export async function listCustomFields(): Promise<CustomFieldDef[]> {
  const m = await getActiveMembership();
  if (!m) return [];
  const rows = await prisma.customField.findMany({ where: { workspaceId: m.workspaceId }, orderBy: { position: "asc" }, select: FIELD_SELECT });
  return rows.map(toDef);
}

const Input = z.object({
  name: FieldName,
  type: z.enum(FIELD_TYPES),
  options: OptionsSchema.default([]),
  boardIds: z.array(z.string()).max(500).nullable(), // null = every board
});

async function checkBoards(workspaceId: string, ids: string[] | null) {
  if (!ids) return true;
  return (await prisma.board.count({ where: { id: { in: ids }, workspaceId } })) === new Set(ids).size;
}

function revalidate() {
  revalidatePath("/settings/labels");
  revalidatePath("/boards", "layout");
  revalidatePath("/cards");
}

export async function createCustomField(input: unknown) {
  const m = await admin();
  if (!m) return { error: "Only workspace admins can add fields." };
  const p = Input.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the field." };
  const { name, type, options, boardIds } = p.data;
  if ((type === "select" || type === "multiselect") && options.length === 0) return { error: "Add at least one option." };
  if (!(await checkBoards(m.workspaceId, boardIds))) return { error: "Board not found." };
  if (boardIds && boardIds.length === 0) return { error: "Pick at least one board, or all boards." };
  const clash = await prisma.customField.findFirst({ where: { workspaceId: m.workspaceId, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  if (clash) return { error: "There’s already a field with that name." };
  const last = await prisma.customField.findFirst({ where: { workspaceId: m.workspaceId }, orderBy: { position: "desc" }, select: { position: true } });
  const f = await prisma.customField.create({
    data: {
      workspaceId: m.workspaceId,
      name,
      type,
      options: type === "select" || type === "multiselect" ? options : [],
      position: generateKeyBetween(last?.position ?? null, null),
      allBoards: boardIds === null,
      boards: boardIds ? { create: boardIds.map((boardId) => ({ boardId })) } : undefined,
    },
    select: FIELD_SELECT,
  });
  revalidate();
  return { field: toDef(f) };
}

const Update = z.object({
  name: FieldName.optional(),
  options: OptionsSchema.optional(),
  boardIds: z.array(z.string()).max(500).nullable().optional(),
});

/** Rename, change options, or change which boards show it. Its type can't change. */
export async function updateCustomField(id: string, input: unknown) {
  const m = await admin();
  if (!m) return { error: "Only workspace admins can change fields." };
  const f = await prisma.customField.findFirst({ where: { id, workspaceId: m.workspaceId }, select: { id: true, type: true, options: true } });
  if (!f) return { error: "Field not found." };
  const p = Update.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the field." };
  const u = p.data;
  if (u.name) {
    const clash = await prisma.customField.findFirst({ where: { workspaceId: m.workspaceId, id: { not: id }, name: { equals: u.name, mode: "insensitive" } }, select: { id: true } });
    if (clash) return { error: "There’s already a field with that name." };
  }
  if (u.options && (f.type === "select" || f.type === "multiselect") && u.options.length === 0) return { error: "Keep at least one option." };
  if (u.boardIds !== undefined && !(await checkBoards(m.workspaceId, u.boardIds))) return { error: "Board not found." };
  if (u.boardIds && u.boardIds.length === 0) return { error: "Pick at least one board, or all boards." };
  await prisma.$transaction(async (tx) => {
    await tx.customField.update({
      where: { id },
      data: {
        ...(u.name ? { name: u.name } : {}),
        ...(u.options ? { options: u.options } : {}),
        ...(u.boardIds !== undefined ? { allBoards: u.boardIds === null } : {}),
      },
    });
    if (u.boardIds !== undefined) {
      await tx.customFieldBoard.deleteMany({ where: { fieldId: id } });
      if (u.boardIds) await tx.customFieldBoard.createMany({ data: u.boardIds.map((boardId) => ({ fieldId: id, boardId })) });
    }
    // A removed option leaves the cards that had it.
    if (u.options) {
      const keep = new Set(u.options.map((o) => o.id));
      const gone = asOptions(f.options).filter((o) => !keep.has(o.id)).map((o) => o.id);
      if (gone.length) {
        const rows = await tx.cardFieldValue.findMany({ where: { fieldId: id, optionIds: { hasSome: gone } }, select: { cardId: true, optionIds: true } });
        for (const r of rows) {
          const left = r.optionIds.filter((x) => !gone.includes(x));
          if (left.length) await tx.cardFieldValue.update({ where: { cardId_fieldId: { cardId: r.cardId, fieldId: id } }, data: { optionIds: left } });
          else await tx.cardFieldValue.delete({ where: { cardId_fieldId: { cardId: r.cardId, fieldId: id } } });
        }
      }
    }
  });
  revalidate();
  return { ok: true as const };
}

export async function deleteCustomField(id: string) {
  const m = await admin();
  if (!m) return { error: "Only workspace admins can delete fields." };
  const res = await prisma.customField.deleteMany({ where: { id, workspaceId: m.workspaceId } });
  if (!res.count) return { error: "Field not found." };
  revalidate();
  return { ok: true as const };
}

export async function moveCustomField(id: string, dir: -1 | 1) {
  const m = await admin();
  if (!m) return { error: "Only workspace admins can reorder fields." };
  const all = await prisma.customField.findMany({ where: { workspaceId: m.workspaceId }, orderBy: { position: "asc" }, select: { id: true, position: true } });
  const i = all.findIndex((f) => f.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= all.length) return { ok: true as const };
  // Insert at index j among the others.
  const rest = all.filter((f) => f.id !== id);
  const before = rest[j - 1]?.position ?? null;
  const after = rest[j]?.position ?? null;
  await prisma.customField.update({ where: { id }, data: { position: generateKeyBetween(before, after) } });
  revalidate();
  return { ok: true as const };
}

/** The fields that show on a card (its board's), with the card's values. */
export async function getCardFields(cardId: string) {
  const card = await getCardForUser(cardId);
  if (!card) return { fields: [] as (CustomFieldDef & { value: FieldValue })[] };
  const [rows, values] = await Promise.all([
    prisma.customField.findMany({ where: { workspaceId: (await prisma.board.findUnique({ where: { id: card.boardId }, select: { workspaceId: true } }))!.workspaceId }, orderBy: { position: "asc" }, select: FIELD_SELECT }),
    prisma.cardFieldValue.findMany({ where: { cardId } }),
  ]);
  return {
    fields: rows
      .map(toDef)
      .filter((f) => fieldOnBoard(f, card.boardId))
      .map((f) => ({ ...f, value: fromStored(f, values.find((v) => v.fieldId === f.id)) })),
  };
}

export async function setCardFieldValue(cardId: string, fieldId: string, value: FieldValue) {
  const card = await getCardForUser(cardId);
  if (!card) return { error: "Card not found." };
  const row = await prisma.customField.findFirst({ where: { id: fieldId, workspace: { boards: { some: { id: card.boardId } } } }, select: FIELD_SELECT });
  if (!row) return { error: "Field not found." };
  const f = toDef(row);
  if (!fieldOnBoard(f, card.boardId)) return { error: "That field isn’t used on this board." };
  const stored = toStored(f, value);
  if ("error" in stored) return { error: stored.error };
  if (stored.ok?.userId) {
    const member = await prisma.membership.findFirst({ where: { userId: stored.ok.userId, workspace: { boards: { some: { id: card.boardId } } }, suspendedAt: null }, select: { userId: true } });
    if (!member) return { error: "That person isn’t a member of this workspace." };
  }
  const before = await prisma.cardFieldValue.findUnique({ where: { cardId_fieldId: { cardId, fieldId } } });
  if (stored.ok) {
    await prisma.cardFieldValue.upsert({ where: { cardId_fieldId: { cardId, fieldId } }, create: { cardId, fieldId, ...stored.ok }, update: stored.ok });
  } else if (before) await prisma.cardFieldValue.delete({ where: { cardId_fieldId: { cardId, fieldId } } });

  const people = async (id: string) => (await prisma.user.findUnique({ where: { id }, select: { name: true, email: true } }))?.name ?? null;
  const show = async (v: FieldValue) => (f.type === "person" && v ? await people(String(v)) : displayValue(f, v));
  const from = await show(fromStored(f, before));
  const to = await show(stored.ok ? fromStored(f, stored.ok) : null);
  if (from !== to) await recordActivity(cardId, (await getCurrentUser())?.id, "field", { name: f.name, from, to });
  await prisma.card.update({ where: { id: cardId }, data: { updatedAt: new Date() } });
  revalidatePath(`/boards/${card.boardId}`);
  return { ok: true as const, value: stored.ok ? fromStored(f, stored.ok) : null };
}
