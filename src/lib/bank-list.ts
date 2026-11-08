import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export const BANK_SELECT = {
  id: true,
  kind: true,
  prompt: true,
  itemType: true,
  bloomLevel: true,
  notes: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  createdBy: { select: { id: true, name: true, email: true } },
  labels: { select: { label: { select: { id: true, name: true, color: true } } } },
  _count: { select: { copies: true } },
} satisfies Prisma.BankItemSelect;

type Row = Prisma.BankItemGetPayload<{ select: typeof BANK_SELECT }>;
export type BankRow = Omit<Row, "labels" | "_count"> & { labels: { id: string; name: string; color: string }[]; copies: number };

export const toBankRow = ({ labels, _count, ...r }: Row): BankRow => ({ ...r, labels: labels.map((l) => l.label), copies: _count.copies });

export type BankFilters = { q?: string; kind?: string; type?: string; bloom?: string; labelId?: string; archived?: string; unused?: string };

export async function listBank(workspaceId: string, f: BankFilters = {}): Promise<BankRow[]> {
  const where: Prisma.BankItemWhereInput = {
    workspaceId,
    archivedAt: f.archived === "1" ? { not: null } : null,
    ...(f.q ? { OR: [{ prompt: { contains: f.q, mode: "insensitive" } }, { notes: { contains: f.q, mode: "insensitive" } }] } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.type ? { itemType: f.type } : {}),
    ...(f.bloom ? { bloomLevel: f.bloom } : {}),
    ...(f.labelId ? { labels: { some: { labelId: f.labelId } } } : {}),
    ...(f.unused === "1" ? { copies: { none: {} } } : {}),
  };
  const rows = await prisma.bankItem.findMany({ where, select: BANK_SELECT, orderBy: { updatedAt: "desc" }, take: 1000 });
  return rows.map(toBankRow);
}

/** "Where is this used": the projects holding copies. Projects the viewer can't see are
 *  counted, not named. */
export async function bankUsage(bankItemId: string, visibleProject: Prisma.ProjectWhereInput) {
  const copies = await prisma.assessmentItem.findMany({
    where: { sourceBankItemId: bankItemId },
    select: { id: true, prompt: true, project: { select: { id: true, name: true } }, projectId: true },
  });
  const visible = new Set(
    (await prisma.project.findMany({ where: { id: { in: [...new Set(copies.map((c) => c.projectId))] }, ...visibleProject }, select: { id: true } })).map((p) => p.id),
  );
  const shown = copies.filter((c) => visible.has(c.projectId));
  return {
    copies: shown.map((c) => ({ id: c.id, prompt: c.prompt, project: c.project })),
    hidden: copies.length - shown.length,
  };
}
