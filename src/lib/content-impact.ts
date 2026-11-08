import "server-only";
import { prisma } from "@/lib/db";

// Impact analysis (docs/CONTENT-LIFECYCLE-REUSE.md, phase 5): "what needs another look
// if this changes?". Dependencies are one edge table (ContentDependency); the impact of
// a change is everything that depends on it, directly or through other content.

/** Outside sources are free text, matched loosely: trimmed, spaces collapsed, any case. */
export function normalizeSource(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export type Origin = { contentId: string } | { externalSource: string };

export type Impacted = {
  id: string;
  title: string;
  status: string;
  owner: { id: string; name: string | null; email: string } | null;
  /** What it depends on that put it in the list (the origin, or an item in between). */
  via: string;
  depth: number;
};

/** Every non-retired content item that depends on the origin, transitively (A depends on
 *  B depends on the policy → both), each once, nearest first. Cycles are harmless. */
export async function impactOf(workspaceId: string, origin: Origin): Promise<Impacted[]> {
  const seen = new Set<string>();
  const out: Impacted[] = [];
  let frontier: { id: string; title: string }[] = [];

  if ("contentId" in origin) {
    const o = await prisma.contentItem.findFirst({ where: { id: origin.contentId, workspaceId }, select: { id: true, title: true } });
    if (!o) return [];
    seen.add(o.id);
    frontier = [o];
  }

  const select = { id: true, title: true, status: true, owner: { select: { id: true, name: true, email: true } } } as const;
  let depth = 1;
  if ("externalSource" in origin) {
    const name = normalizeSource(origin.externalSource);
    const edges = await prisma.contentDependency.findMany({
      where: { workspaceId, externalSource: { equals: name, mode: "insensitive" } },
      select: { source: { select } },
    });
    for (const e of edges) {
      if (seen.has(e.source.id)) continue;
      seen.add(e.source.id);
      if (e.source.status !== "retired") out.push({ ...e.source, via: name, depth });
      frontier.push(e.source);
    }
    depth++;
  }

  while (frontier.length && depth < 20) {
    const titles = new Map(frontier.map((f) => [f.id, f.title]));
    const edges = await prisma.contentDependency.findMany({
      where: { workspaceId, targetId: { in: [...titles.keys()] } },
      select: { targetId: true, source: { select } },
    });
    const next: { id: string; title: string }[] = [];
    for (const e of edges) {
      if (seen.has(e.source.id)) continue;
      seen.add(e.source.id);
      if (e.source.status !== "retired") out.push({ ...e.source, via: titles.get(e.targetId!)!, depth });
      next.push(e.source);
    }
    frontier = next;
    depth++;
  }
  return out;
}

/** The outside sources a workspace's content depends on, with how many items each. */
export async function externalSources(workspaceId: string) {
  const edges = await prisma.contentDependency.findMany({
    where: { workspaceId, externalSource: { not: null } },
    select: { externalSource: true, source: { select: { id: true, title: true, status: true } } },
  });
  const by = new Map<string, { name: string; items: { id: string; title: string; status: string }[] }>();
  for (const e of edges) {
    const key = normalizeSource(e.externalSource!).toLowerCase();
    const entry = by.get(key) ?? { name: normalizeSource(e.externalSource!), items: [] };
    if (!entry.items.some((i) => i.id === e.source.id)) entry.items.push(e.source);
    by.set(key, entry);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}
