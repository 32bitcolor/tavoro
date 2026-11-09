import "server-only";
import { prisma } from "@/lib/db";
import { boardVisibilityWhere } from "@/lib/authz";
import { asCardType, asPriority, priorityRank } from "@/lib/card-fields";
import { asFieldType, asOptions, displayValue, fromStored } from "@/lib/custom-fields";
import { compileQuery, type OrderField, type QueryCtx } from "@/lib/query/compile";
import { QueryError } from "@/lib/query/parse";
import type { Prisma } from "@/generated/prisma/client";

// Running a card query (docs/JIRA-PARITY.md, phase 7). The caller's board visibility is
// always ANDed on, so a query can never reach a card its author couldn't open.

/** The most cards a query sorts; past this the result says it was cut short. */
export const QUERY_LIMIT = 5000;

export async function queryContext(workspaceId: string, userId: string): Promise<QueryCtx> {
  const [statuses, labels, members, sprints, boards, projects, epics, customFields] = await Promise.all([
    prisma.workspaceStatus.findMany({ where: { workspaceId }, orderBy: { position: "asc" }, select: { id: true, name: true, category: true } }),
    prisma.label.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.membership.findMany({ where: { workspaceId, suspendedAt: null }, select: { user: { select: { id: true, name: true, email: true } } } }),
    prisma.sprint.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, status: true } }),
    prisma.board.findMany({ where: { workspaceId, ...(await boardVisibilityWhere()) }, orderBy: { name: "asc" }, select: { id: true, name: true, cardKeyPrefix: true } }),
    prisma.project.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.card.findMany({
      where: { type: "epic", columnId: { not: null }, column: { board: { workspaceId, ...(await boardVisibilityWhere()) } } },
      select: { id: true, title: true, keySeq: true, column: { select: { board: { select: { cardKeyPrefix: true } } } } },
      take: 1000,
    }),
    prisma.customField.findMany({ where: { workspaceId }, orderBy: { position: "asc" }, select: { id: true, name: true, type: true, options: true } }),
  ]);
  return {
    me: userId,
    now: new Date(),
    statuses,
    labels,
    members: members.map((m) => m.user),
    sprints,
    boards: boards.map((b) => ({ id: b.id, name: b.name, prefix: b.cardKeyPrefix })),
    projects,
    epics: epics.map((e) => ({ id: e.id, title: e.title, key: e.column?.board.cardKeyPrefix && e.keySeq != null ? `${e.column.board.cardKeyPrefix}-${e.keySeq}` : null })),
    customFields: customFields.map((f) => ({ id: f.id, name: f.name, type: f.type, options: asOptions(f.options) })),
    cardIdsForKeys: async (keys) => {
      const out = new Map<string, string>();
      const parsed = keys.map((k) => /^([A-Z][A-Z0-9]{0,9})-(\d+)$/.exec(k)).filter((m): m is RegExpExecArray => !!m);
      if (!parsed.length) return out;
      const rows = await prisma.card.findMany({
        where: { keySeq: { in: parsed.map((m) => Number(m[2])) }, column: { board: { workspaceId, cardKeyPrefix: { in: parsed.map((m) => m[1]) } } } },
        select: { id: true, keySeq: true, column: { select: { board: { select: { cardKeyPrefix: true } } } } },
      });
      for (const r of rows) out.set(`${r.column!.board.cardKeyPrefix}-${r.keySeq}`, r.id);
      const missing = keys.filter((k) => !out.has(k));
      if (missing.length) {
        // Keys a card had before it moved, or its Jira key from an import.
        const imported = await prisma.importedCard.findMany({ where: { workspaceId, externalKey: { in: missing } }, select: { cardId: true, externalKey: true } });
        for (const r of imported) out.set(r.externalKey.toUpperCase(), r.cardId);
        for (const m of parsed.filter((m) => !out.has(m[0]))) {
          const alias = await prisma.cardKeyAlias.findFirst({ where: { keySeq: Number(m[2]), board: { workspaceId, cardKeyPrefix: m[1] } }, select: { cardId: true } });
          if (alias) out.set(m[0], alias.cardId);
        }
      }
      return out;
    },
    blockedIds: async () => {
      const links = await prisma.cardLink.findMany({
        where: { type: "blocks", from: { column: { board: { workspaceId } }, NOT: { status: { category: "done" } } } },
        select: { toId: true },
      });
      return [...new Set(links.map((l) => l.toId))];
    },
  };
}

const ROW = {
  id: true,
  title: true,
  keySeq: true,
  type: true,
  priority: true,
  estimate: true,
  dueDate: true,
  startDate: true,
  createdAt: true,
  updatedAt: true,
  rank: true,
  status: { select: { name: true, category: true } },
  sprint: { select: { id: true, name: true } },
  epic: { select: { id: true, title: true, keySeq: true, column: { select: { board: { select: { cardKeyPrefix: true } } } } } },
  assignees: { select: { user: { select: { id: true, name: true, email: true } } } },
  labels: { select: { label: { select: { id: true, name: true, color: true } } } },
  column: { select: { board: { select: { id: true, name: true, cardKeyPrefix: true, project: { select: { id: true, name: true } } } } } },
  fieldValues: { select: { fieldId: true, text: true, number: true, date: true, bool: true, optionIds: true, userId: true, updatedAt: true, user: { select: { name: true, email: true } } } },
} as const;

export type QueryRow = {
  id: string;
  key: string | null;
  title: string;
  type: ReturnType<typeof asCardType>;
  priority: ReturnType<typeof asPriority>;
  estimate: number | null;
  status: { name: string; category: string } | null;
  sprint: { id: string; name: string } | null;
  epic: { id: string; title: string; key: string | null } | null;
  assignees: { id: string; name: string | null; email: string }[];
  labels: { id: string; name: string; color: string }[];
  board: { id: string; name: string };
  project: { id: string; name: string } | null;
  due: string | null;
  start: string | null;
  created: string;
  updated: string;
  /** Custom field values, shown as text, by field id. */
  fields: Record<string, string>;
};

type SortRow = { id: string; title: string; keySeq: number | null; prefix: string | null; type: string; priority: string | null; estimate: number | null; dueDate: Date | null; startDate: Date | null; createdAt: Date; updatedAt: Date; rank: string | null; statusPos: string | null };

function sorter(order: { field: OrderField; desc: boolean }[]) {
  const ord = order.length ? order : [{ field: "updated" as OrderField, desc: true }];
  const val = (r: SortRow, f: OrderField): string | number | null => {
    switch (f) {
      case "rank":
        return r.rank;
      case "key":
        return r.prefix && r.keySeq != null ? `${r.prefix}-${String(r.keySeq).padStart(8, "0")}` : null;
      case "title":
        return r.title.toLowerCase();
      case "created":
        return r.createdAt.getTime();
      case "updated":
        return r.updatedAt.getTime();
      case "due":
        return r.dueDate?.getTime() ?? null;
      case "start":
        return r.startDate?.getTime() ?? null;
      case "priority":
        // Highest first when descending, like Jira.
        return r.priority ? 4 - priorityRank(asPriority(r.priority)) : null;
      case "estimate":
        return r.estimate;
      case "status":
        return r.statusPos;
      case "type":
        return r.type;
    }
  };
  return (a: SortRow, b: SortRow) => {
    for (const o of ord) {
      const x = val(a, o.field);
      const y = val(b, o.field);
      if (x === y) continue;
      // Empty values sort last either way.
      if (x == null) return 1;
      if (y == null) return -1;
      const c = x < y ? -1 : 1;
      return o.desc ? -c : c;
    }
    return a.id < b.id ? -1 : 1;
  };
}

export type QueryResult =
  | { ok: true; total: number; truncated: boolean; rows: QueryRow[]; ids: string[] }
  | { ok: false; error: string; pos: number; end: number };

/** Run a query: one page of rows, plus every matching id (for "select all"), sorted. */
export async function runQuery(workspaceId: string, userId: string, query: string, page = 0, pageSize = 50): Promise<QueryResult> {
  let compiled;
  const ctx = await queryContext(workspaceId, userId);
  try {
    compiled = await compileQuery(query, ctx);
  } catch (e) {
    if (e instanceof QueryError) return { ok: false, error: e.message, pos: e.pos, end: e.end };
    throw e;
  }
  const where: Prisma.CardWhereInput = {
    AND: [{ columnId: { not: null }, column: { board: { workspaceId, ...(await boardVisibilityWhere()) } } }, compiled.where],
  };
  const matches = await prisma.card.findMany({
    where,
    take: QUERY_LIMIT + 1,
    select: {
      id: true, title: true, keySeq: true, type: true, priority: true, estimate: true, dueDate: true, startDate: true, createdAt: true, updatedAt: true, rank: true,
      status: { select: { position: true } },
      column: { select: { board: { select: { cardKeyPrefix: true } } } },
    },
  });
  const truncated = matches.length > QUERY_LIMIT;
  const sorted = matches
    .slice(0, QUERY_LIMIT)
    .map((m) => ({ ...m, prefix: m.column?.board.cardKeyPrefix ?? null, statusPos: m.status?.position ?? null }))
    .sort(sorter(compiled.order));
  const ids = sorted.map((r) => r.id);
  const pageIds = ids.slice(page * pageSize, page * pageSize + pageSize);
  const details = await prisma.card.findMany({ where: { id: { in: pageIds } }, select: ROW });
  const byId = new Map(details.map((d) => [d.id, d]));
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const rows = pageIds.flatMap((id): QueryRow[] => {
    const c = byId.get(id);
    if (!c) return [];
    const b = c.column!.board;
    return [
      {
        id: c.id,
        key: b.cardKeyPrefix && c.keySeq != null ? `${b.cardKeyPrefix}-${c.keySeq}` : null,
        title: c.title,
        type: asCardType(c.type),
        priority: asPriority(c.priority),
        estimate: c.estimate,
        status: c.status,
        sprint: c.sprint,
        epic: c.epic ? { id: c.epic.id, title: c.epic.title, key: c.epic.column?.board.cardKeyPrefix && c.epic.keySeq != null ? `${c.epic.column.board.cardKeyPrefix}-${c.epic.keySeq}` : null } : null,
        assignees: c.assignees.map((a) => a.user),
        labels: c.labels.map((l) => l.label),
        board: { id: b.id, name: b.name },
        project: b.project,
        due: day(c.dueDate),
        start: day(c.startDate),
        created: c.createdAt.toISOString(),
        updated: c.updatedAt.toISOString(),
        fields: Object.fromEntries(
          c.fieldValues.flatMap((fv) => {
            const def = ctx.customFields?.find((f) => f.id === fv.fieldId);
            if (!def) return [];
            const f = { type: asFieldType(def.type), options: def.options };
            const shown = f.type === "person" ? (fv.user?.name ?? fv.user?.email ?? null) : displayValue(f, fromStored(f, fv));
            return shown ? [[fv.fieldId, shown]] : [];
          }),
        ),
      },
    ];
  });
  return { ok: true, total: ids.length, truncated, rows, ids };
}
