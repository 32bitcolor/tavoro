// A query context for the whole workspace, with no viewer: automation rules (run by the
// worker) match cards on every board. Relative imports and no "server-only" for the
// worker. The Cards page uses run.ts's queryContext, which applies the viewer's access.
import type { PrismaClient } from "../../generated/prisma/client";
import { asOptions } from "../custom-fields";
import type { QueryCtx } from "./compile";

export async function workspaceQueryContext(db: PrismaClient, workspaceId: string, meId: string): Promise<QueryCtx> {
  const [statuses, labels, members, sprints, boards, projects, epics, customFields] = await Promise.all([
    db.workspaceStatus.findMany({ where: { workspaceId }, select: { id: true, name: true, category: true } }),
    db.label.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    db.membership.findMany({ where: { workspaceId, suspendedAt: null }, select: { user: { select: { id: true, name: true, email: true } } } }),
    db.sprint.findMany({ where: { workspaceId }, select: { id: true, name: true, status: true } }),
    db.board.findMany({ where: { workspaceId }, select: { id: true, name: true, cardKeyPrefix: true } }),
    db.project.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    db.card.findMany({
      where: { type: "epic", columnId: { not: null }, column: { board: { workspaceId } } },
      select: { id: true, title: true, keySeq: true, column: { select: { board: { select: { cardKeyPrefix: true } } } } },
      take: 1000,
    }),
    db.customField.findMany({ where: { workspaceId }, select: { id: true, name: true, type: true, options: true } }),
  ]);
  return {
    me: meId,
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
      for (const k of keys) {
        const m = /^([A-Z][A-Z0-9]{0,9})-(\d+)$/.exec(k);
        if (!m) continue;
        const c = await db.card.findFirst({ where: { keySeq: Number(m[2]), column: { board: { workspaceId, cardKeyPrefix: m[1] } } }, select: { id: true } });
        if (c) out.set(k, c.id);
      }
      return out;
    },
    blockedIds: async () => {
      const links = await db.cardLink.findMany({ where: { type: "blocks", from: { column: { board: { workspaceId } }, NOT: { status: { category: "done" } } } }, select: { toId: true } });
      return [...new Set(links.map((l) => l.toId))];
    },
  };
}
