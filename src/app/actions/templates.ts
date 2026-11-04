"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { getDeliverableForUser, getProjectForUser, getStoryboardForUser } from "@/lib/authz";
import {
  describeSnapshot,
  instantiateProject,
  instantiateStoryboard,
  parseSnapshot,
  snapshotProject,
  snapshotStoryboard,
  snapshotTooBig,
  TEMPLATE_KINDS,
  type TemplateKind,
} from "@/lib/templates";
import { Role } from "@/generated/prisma/client";

// Templates are workspace-wide: every member can see and use them, and save new ones.
// Changing or deleting one is for whoever saved it, or an admin or manager.

const Name = z.string().trim().min(1, "Give the template a name.").max(140);
const Description = z.string().trim().max(2000).nullable();
const Kind = z.enum(TEMPLATE_KINDS);

function touched() {
  revalidatePath("/templates");
  revalidatePath("/projects");
  revalidatePath("/storyboards");
}

export type TemplateSummary = {
  id: string;
  kind: TemplateKind;
  name: string;
  description: string | null;
  summary: string;
  createdBy: string | null;
  updatedAt: string;
  canManage: boolean;
};

/** Templates in the active workspace, newest first. */
export async function listTemplates(kind?: TemplateKind): Promise<TemplateSummary[]> {
  const m = await getActiveMembership();
  if (!m) return [];
  const rows = await prisma.template.findMany({
    where: { workspaceId: m.workspaceId, ...(kind ? { kind } : {}) },
    orderBy: [{ name: "asc" }],
    select: { id: true, kind: true, name: true, description: true, data: true, createdById: true, updatedAt: true, createdBy: { select: { name: true } } },
  });
  const manager = m.role === Role.ADMIN || m.role === Role.MANAGER;
  return rows.map((t) => ({
    id: t.id,
    kind: t.kind as TemplateKind,
    name: t.name,
    description: t.description,
    summary: describeSnapshot(t.kind, t.data),
    createdBy: t.createdBy?.name ?? null,
    updatedAt: t.updatedAt.toISOString(),
    canManage: manager || t.createdById === m.userId,
  }));
}

/** The template, if it's in the active workspace and the caller may change it. */
async function manageable(id: string) {
  const m = await getActiveMembership();
  if (!m) return { error: "Not signed in." } as const;
  const t = await prisma.template.findFirst({ where: { id, workspaceId: m.workspaceId }, select: { id: true, kind: true, createdById: true } });
  if (!t) return { error: "Template not found." } as const;
  if (m.role !== Role.ADMIN && m.role !== Role.MANAGER && t.createdById !== m.userId) {
    return { error: "Only whoever saved this template, or an admin or manager, can change it." } as const;
  }
  return { template: t, membership: m } as const;
}

/** Save a project or storyboard as a new template, or overwrite an existing one of the same kind. */
export async function saveAsTemplate(input: { kind: TemplateKind; sourceId: string; name: string; description?: string | null; replaceId?: string | null }) {
  const m = await getActiveMembership();
  if (!m) return { error: "Not signed in." };
  const kind = Kind.safeParse(input.kind);
  if (!kind.success) return { error: "Unknown template type." };
  const name = Name.safeParse(input.name);
  if (!name.success) return { error: name.error.issues[0].message };
  const description = Description.safeParse(input.description?.trim() ? input.description : null);
  if (!description.success) return { error: "Keep the description under 2,000 characters." };

  const source = kind.data === "project" ? await getProjectForUser(input.sourceId) : await getStoryboardForUser(input.sourceId);
  if (!source) return { error: kind.data === "project" ? "Project not found." : "Storyboard not found." };
  if (source.workspaceId !== m.workspaceId) return { error: "Switch to that workspace first." };

  const data = kind.data === "project" ? await snapshotProject(source.id) : await snapshotStoryboard(source.id);
  if (snapshotTooBig(data)) return { error: "That's too big to save as a template. Remove some screens or cards and try again." };

  if (input.replaceId) {
    const t = await manageable(input.replaceId);
    if ("error" in t) return { error: t.error };
    if (t.template.kind !== kind.data) return { error: "Pick a template of the same type to replace." };
    await prisma.template.update({ where: { id: t.template.id }, data: { name: name.data, description: description.data, data } });
    touched();
    return { id: t.template.id, replaced: true };
  }
  const t = await prisma.template.create({
    data: { workspaceId: m.workspaceId, kind: kind.data, name: name.data, description: description.data, data, createdById: m.userId },
    select: { id: true },
  });
  touched();
  return { id: t.id, replaced: false };
}

export async function updateTemplate(id: string, patch: { name?: string; description?: string | null }) {
  const t = await manageable(id);
  if ("error" in t) return { error: t.error };
  const data: { name?: string; description?: string | null } = {};
  if (patch.name !== undefined) {
    const n = Name.safeParse(patch.name);
    if (!n.success) return { error: n.error.issues[0].message };
    data.name = n.data;
  }
  if (patch.description !== undefined) {
    const d = Description.safeParse(patch.description?.trim() ? patch.description : null);
    if (!d.success) return { error: "Keep the description under 2,000 characters." };
    data.description = d.data;
  }
  await prisma.template.update({ where: { id }, data });
  touched();
  return { ok: true as const };
}

export async function deleteTemplate(id: string) {
  const t = await manageable(id);
  if ("error" in t) return { error: t.error };
  await prisma.template.delete({ where: { id } });
  touched();
  return { ok: true as const };
}

async function loadTemplate(id: string, kind: TemplateKind, workspaceId: string) {
  return prisma.template.findFirst({ where: { id, workspaceId, kind }, select: { id: true, name: true, data: true } });
}

const StartDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => new Date(`${s}T00:00:00.000Z`).toISOString().startsWith(s))
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

/** A new project in the active workspace, built from a project template. */
export async function createProjectFromTemplate(templateId: string, name: string, startDate?: string | null) {
  const m = await getActiveMembership();
  if (!m) return { error: "Not signed in." };
  const n = z.string().trim().min(1).max(140).safeParse(name);
  if (!n.success) return { error: "Project name is required." };
  const start = startDate ? StartDay.safeParse(startDate) : null;
  if (start && !start.success) return { error: "Use a start date like 2027-01-31." };
  const t = await loadTemplate(templateId, "project", m.workspaceId);
  if (!t) return { error: "Template not found." };
  const snap = parseSnapshot("project", t.data);
  if (!snap) return { error: "This template can't be read. Save it again from a project." };
  const project = await instantiateProject(m.workspaceId, snap, n.data, start?.data ?? new Date());
  revalidatePath("/projects");
  return { id: project.id };
}

/** A new storyboard from a storyboard template: standalone, or for a deliverable that has none yet. */
export async function createStoryboardFromTemplate(templateId: string, title: string, deliverableId?: string | null) {
  const m = await getActiveMembership();
  if (!m) return { error: "Not signed in." };
  const t = await loadTemplate(templateId, "storyboard", m.workspaceId);
  if (!t) return { error: "Template not found." };
  const snap = parseSnapshot("storyboard", t.data);
  if (!snap) return { error: "This template can't be read. Save it again from a storyboard." };
  let projectId: string | null = null;
  if (deliverableId) {
    const d = await getDeliverableForUser(deliverableId);
    if (!d) return { error: "Deliverable not found." };
    const inWorkspace = await prisma.project.findFirst({ where: { id: d.projectId, workspaceId: m.workspaceId }, select: { id: true } });
    if (!inWorkspace) return { error: "Switch to this project's workspace first." };
    const existing = await prisma.storyboard.findUnique({ where: { deliverableId }, select: { id: true } });
    if (existing) return { error: "That deliverable already has a storyboard." };
    projectId = d.projectId;
  }
  const n = z.string().trim().min(1).max(180).safeParse(title);
  if (!n.success) return { error: "Title is required." };
  const sb = await instantiateStoryboard(m.workspaceId, snap, n.data, deliverableId ?? null);
  revalidatePath("/storyboards");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return { storyboard: sb };
}
