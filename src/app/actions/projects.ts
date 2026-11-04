"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { getProjectForUser, getPhaseForUser } from "@/lib/authz";
import { positionBetween, positionForIndex } from "@/lib/ordering";
import { createProjectForWorkspace } from "@/lib/projects";
import { createProjectFromTemplate } from "@/app/actions/templates";
import { PHASE_STATUSES, PROJECT_STATUSES } from "@/lib/methodology";

const Name = z.string().trim().min(1, "Required").max(140);
const Methodology = z.enum(["ADDIE", "SAM", "CUSTOM"]);

function projectPath(projectId: string) {
  return `/projects/${projectId}`;
}

// ── Projects ─────────────────────────────────────────────────────────────────

export async function createProject(formData: FormData): Promise<void> {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");

  const name = Name.safeParse(formData.get("name"));
  if (!name.success) return;
  const templateId = String(formData.get("templateId") ?? "");
  if (templateId) {
    const res = await createProjectFromTemplate(templateId, name.data, String(formData.get("startDate") ?? "") || null);
    if ("id" in res && res.id) redirect(projectPath(res.id));
    return;
  }
  const methodology = Methodology.catch("ADDIE").parse(formData.get("methodology"));

  const project = await createProjectForWorkspace(membership.workspaceId, name.data, methodology);

  redirect(projectPath(project.id));
}

export async function renameProject(projectId: string, name: string) {
  const project = await getProjectForUser(projectId);
  if (!project) return { error: "Project not found." };
  const parsed = Name.safeParse(name);
  if (!parsed.success) return { error: "Project name is required." };
  await prisma.project.update({ where: { id: projectId }, data: { name: parsed.data } });
  revalidatePath(projectPath(projectId));
  revalidatePath("/projects");
}

export async function updateProjectDescription(projectId: string, description: string) {
  const project = await getProjectForUser(projectId);
  if (!project) return { error: "Project not found." };
  await prisma.project.update({
    where: { id: projectId },
    data: { description: description.trim() ? description.trim().slice(0, 5000) : null },
  });
  revalidatePath(projectPath(projectId));
}

export async function setProjectStatus(projectId: string, status: string) {
  const project = await getProjectForUser(projectId);
  if (!project) return { error: "Project not found." };
  const parsed = z.enum(PROJECT_STATUSES).safeParse(status);
  if (!parsed.success) return { error: "Invalid status." };
  await prisma.project.update({ where: { id: projectId }, data: { status: parsed.data } });
  revalidatePath(projectPath(projectId));
  revalidatePath("/projects");
}

export async function deleteProject(projectId: string) {
  const project = await getProjectForUser(projectId);
  if (!project) return { error: "Project not found." };
  await prisma.project.delete({ where: { id: projectId } });
  redirect("/projects");
}

// ── Phases ───────────────────────────────────────────────────────────────────

export async function createPhase(projectId: string, name: string) {
  const project = await getProjectForUser(projectId);
  if (!project) return { error: "Project not found." };
  const parsed = Name.safeParse(name);
  if (!parsed.success) return { error: "Phase name is required." };

  const last = await prisma.phase.findFirst({
    where: { projectId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const phase = await prisma.phase.create({
    data: { projectId, name: parsed.data, position: positionBetween(last?.position ?? null, null) },
    select: { id: true, name: true, status: true, position: true, startDate: true, endDate: true },
  });
  revalidatePath(projectPath(projectId));
  return { phase };
}

export async function renamePhase(phaseId: string, name: string) {
  const phase = await getPhaseForUser(phaseId);
  if (!phase) return { error: "Phase not found." };
  const parsed = Name.safeParse(name);
  if (!parsed.success) return { error: "Phase name is required." };
  await prisma.phase.update({ where: { id: phaseId }, data: { name: parsed.data } });
  revalidatePath(projectPath(phase.projectId));
}

export async function setPhaseStatus(phaseId: string, status: string) {
  const phase = await getPhaseForUser(phaseId);
  if (!phase) return { error: "Phase not found." };
  const parsed = z.enum(PHASE_STATUSES).safeParse(status);
  if (!parsed.success) return { error: "Invalid status." };
  await prisma.phase.update({ where: { id: phaseId }, data: { status: parsed.data } });
  revalidatePath(projectPath(phase.projectId));
}

export async function setPhaseDates(phaseId: string, startIso: string | null, endIso: string | null) {
  const phase = await getPhaseForUser(phaseId);
  if (!phase) return { error: "Phase not found." };
  const start = startIso ? new Date(startIso) : null;
  const end = endIso ? new Date(endIso) : null;
  if (start && Number.isNaN(start.getTime())) return { error: "Invalid start date." };
  if (end && Number.isNaN(end.getTime())) return { error: "Invalid end date." };
  await prisma.phase.update({ where: { id: phaseId }, data: { startDate: start, endDate: end } });
  revalidatePath(projectPath(phase.projectId));
}

export async function movePhase(phaseId: string, targetIndex: number) {
  const phase = await getPhaseForUser(phaseId);
  if (!phase) return { error: "Phase not found." };
  const siblings = await prisma.phase.findMany({
    where: { projectId: phase.projectId, id: { not: phaseId } },
    orderBy: { position: "asc" },
    select: { position: true },
  });
  const position = positionForIndex(siblings.map((p) => p.position), targetIndex);
  await prisma.phase.update({ where: { id: phaseId }, data: { position } });
  revalidatePath(projectPath(phase.projectId));
}

export async function deletePhase(phaseId: string) {
  const phase = await getPhaseForUser(phaseId);
  if (!phase) return { error: "Phase not found." };
  await prisma.phase.delete({ where: { id: phaseId } });
  revalidatePath(projectPath(phase.projectId));
}
