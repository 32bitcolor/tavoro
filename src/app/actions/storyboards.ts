"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { getActiveMembership } from "@/lib/dal";
import { getStoryboardForUser, getScreenForUser, getDeliverableForUser } from "@/lib/authz";
import { positionBetween, positionForIndex } from "@/lib/ordering";
import { createStoryboardFromTemplate } from "@/app/actions/templates";
import { STORYBOARD_STATUSES, SCREEN_TYPES, SCREEN_FIELDS, type ScreenFieldKey } from "@/lib/storyboard";

const Title = z.string().trim().min(1, "Required").max(180);
const ScreenTitle = z.string().trim().min(1, "Required").max(200);
const ScreenField = z.enum(SCREEN_FIELDS.map((f) => f.key) as [ScreenFieldKey, ...ScreenFieldKey[]]);

function storyboardPath(storyboardId: string) {
  return `/storyboards/${storyboardId}`;
}

// ── Storyboards ──────────────────────────────────────────────────────────────

export async function createStoryboard(formData: FormData): Promise<void> {
  const templateId = String(formData.get("templateId") ?? "");
  const res = templateId
    ? await createStoryboardFromTemplate(templateId, String(formData.get("title") ?? ""))
    : await createStoryboardNamed(String(formData.get("title") ?? ""));
  if (res.storyboard) redirect(storyboardPath(res.storyboard.id));
  if (res.error === "Not signed in.") redirect("/login");
}

/** A standalone storyboard in the active workspace. */
export async function createStoryboardNamed(title: string) {
  const membership = await getActiveMembership();
  if (!membership) return { error: "Not signed in." };
  const parsed = Title.safeParse(title);
  if (!parsed.success) return { error: "Title is required." };
  const storyboard = await prisma.storyboard.create({
    data: { workspaceId: membership.workspaceId, title: parsed.data },
    select: { id: true, title: true },
  });
  revalidatePath("/storyboards");
  return { storyboard };
}

export async function renameStoryboard(storyboardId: string, title: string) {
  const sb = await getStoryboardForUser(storyboardId);
  if (!sb) return { error: "Storyboard not found." };
  const parsed = Title.safeParse(title);
  if (!parsed.success) return { error: "Title is required." };
  await prisma.storyboard.update({ where: { id: storyboardId }, data: { title: parsed.data } });
  revalidatePath(storyboardPath(storyboardId));
  revalidatePath("/storyboards");
}

export async function updateStoryboardDescription(storyboardId: string, description: string) {
  const sb = await getStoryboardForUser(storyboardId);
  if (!sb) return { error: "Storyboard not found." };
  await prisma.storyboard.update({
    where: { id: storyboardId },
    data: { description: description.trim() ? description.trim().slice(0, 2000) : null },
  });
  revalidatePath(storyboardPath(storyboardId));
}

export async function setStoryboardStatus(storyboardId: string, status: string) {
  const sb = await getStoryboardForUser(storyboardId);
  if (!sb) return { error: "Storyboard not found." };
  const parsed = z.enum(STORYBOARD_STATUSES).safeParse(status);
  if (!parsed.success) return { error: "Invalid status." };
  await prisma.storyboard.update({ where: { id: storyboardId }, data: { status: parsed.data } });
  revalidatePath(storyboardPath(storyboardId));
  revalidatePath("/storyboards");
}

export async function deleteStoryboard(storyboardId: string) {
  const sb = await getStoryboardForUser(storyboardId);
  if (!sb) return { error: "Storyboard not found." };
  await prisma.storyboard.delete({ where: { id: storyboardId } });
  redirect("/storyboards");
}

/**
 * Create a storyboard linked to a project deliverable (titled after it). If one
 * is already linked, returns the existing storyboard instead of creating another.
 */
export async function createStoryboardForDeliverable(deliverableId: string) {
  const access = await getDeliverableForUser(deliverableId);
  if (!access) return { error: "Deliverable not found." };
  const deliverable = await prisma.deliverable.findUnique({
    where: { id: deliverableId },
    select: {
      name: true,
      project: { select: { workspaceId: true } },
      storyboard: { select: { id: true, title: true } },
    },
  });
  if (!deliverable) return { error: "Deliverable not found." };
  if (deliverable.storyboard) return { storyboard: deliverable.storyboard };

  const storyboard = await prisma.storyboard.create({
    data: { workspaceId: deliverable.project.workspaceId, deliverableId, title: deliverable.name },
    select: { id: true, title: true },
  });
  revalidatePath(`/projects/${access.projectId}`);
  revalidatePath("/storyboards");
  return { storyboard };
}

// ── Screens ──────────────────────────────────────────────────────────────────

const SCREEN_SELECT = {
  id: true,
  title: true,
  screenType: true,
  position: true,
  onScreenText: true,
  narration: true,
  visualNotes: true,
  interactionNotes: true,
  developerNotes: true,
} satisfies Prisma.ScreenSelect;

export async function createScreen(storyboardId: string, title: string) {
  const sb = await getStoryboardForUser(storyboardId);
  if (!sb) return { error: "Storyboard not found." };
  const parsed = ScreenTitle.safeParse(title);
  if (!parsed.success) return { error: "Screen title is required." };

  const last = await prisma.screen.findFirst({
    where: { storyboardId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const screen = await prisma.screen.create({
    data: { storyboardId, title: parsed.data, position: positionBetween(last?.position ?? null, null) },
    select: SCREEN_SELECT,
  });
  revalidatePath(storyboardPath(storyboardId));
  return { screen };
}

export async function renameScreen(id: string, title: string) {
  const s = await getScreenForUser(id);
  if (!s) return { error: "Screen not found." };
  const parsed = ScreenTitle.safeParse(title);
  if (!parsed.success) return { error: "Screen title is required." };
  await prisma.screen.update({ where: { id }, data: { title: parsed.data } });
  revalidatePath(storyboardPath(s.storyboardId));
}

export async function setScreenType(id: string, screenType: string) {
  const s = await getScreenForUser(id);
  if (!s) return { error: "Screen not found." };
  const parsed = z.enum(SCREEN_TYPES).safeParse(screenType);
  if (!parsed.success) return { error: "Invalid screen type." };
  await prisma.screen.update({ where: { id }, data: { screenType: parsed.data } });
  revalidatePath(storyboardPath(s.storyboardId));
}

/** Save one of the screen's rich-text fields (TipTap JSON, or null when empty). */
export async function updateScreenField(id: string, field: string, value: string | null) {
  const s = await getScreenForUser(id);
  if (!s) return { error: "Screen not found." };
  const parsedField = ScreenField.safeParse(field);
  if (!parsedField.success) return { error: "Invalid field." };
  const content = value && value.trim() ? value : null;
  await prisma.screen.update({
    where: { id },
    data: { [parsedField.data]: content } as Prisma.ScreenUpdateInput,
  });
  revalidatePath(storyboardPath(s.storyboardId));
}

export async function moveScreen(id: string, targetIndex: number) {
  const s = await getScreenForUser(id);
  if (!s) return { error: "Screen not found." };
  const siblings = await prisma.screen.findMany({
    where: { storyboardId: s.storyboardId, id: { not: id } },
    orderBy: { position: "asc" },
    select: { position: true },
  });
  const position = positionForIndex(siblings.map((x) => x.position), targetIndex);
  await prisma.screen.update({ where: { id }, data: { position } });
  revalidatePath(storyboardPath(s.storyboardId));
}

export async function deleteScreen(id: string) {
  const s = await getScreenForUser(id);
  if (!s) return { error: "Screen not found." };
  await prisma.screen.delete({ where: { id } });
  revalidatePath(storyboardPath(s.storyboardId));
}
