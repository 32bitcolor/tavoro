import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/dal";
import { boardVisibilityWhere, projectVisibilityWhere } from "@/lib/authz";
import { isDecided } from "@/lib/methodology";
import { day, link, principal, tool } from "@/lib/mcp/util";

export function cardHref(boardId: string, cardId: string) {
  return link(`/boards/${boardId}?card=${cardId}`);
}

export function registerWorkspaceTools(server: McpServer) {
  tool(
    server,
    "get_workspace",
    {
      title: "Workspace overview",
      description:
        "Who you are, which workspace this connection works in, and the reference lists other tools take as input: members (for assignees and reviewers), board statuses, labels, sprints and custom card fields. Call this first in a conversation.",
      input: {},
      kind: "read",
    },
    async () => {
      const p = principal();
      const me = await getCurrentUser();
      const [ws, members, statuses, labels, sprints, customFields] = await Promise.all([
        prisma.workspace.findUniqueOrThrow({ where: { id: p.workspaceId }, select: { id: true, name: true, slug: true } }),
        prisma.membership.findMany({
          where: { workspaceId: p.workspaceId, suspendedAt: null },
          orderBy: { createdAt: "asc" },
          select: { role: true, user: { select: { id: true, name: true, email: true } } },
        }),
        prisma.workspaceStatus.findMany({ where: { workspaceId: p.workspaceId }, orderBy: { position: "asc" }, select: { id: true, name: true, category: true } }),
        prisma.label.findMany({ where: { workspaceId: p.workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
        prisma.sprint.findMany({
          where: { workspaceId: p.workspaceId },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, status: true, startDate: true, endDate: true, goal: true },
        }),
        prisma.customField.findMany({ where: { workspaceId: p.workspaceId }, orderBy: { position: "asc" }, select: { name: true, type: true, options: true, allBoards: true } }),
      ]);
      return {
        workspace: { ...ws, url: link("/dashboard") },
        you: { id: me?.id, name: me?.name, email: me?.email, role: members.find((m) => m.user.id === me?.id)?.role },
        access: p.canWrite ? "read write" : "read",
        members: members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email, role: m.role })),
        statuses,
        labels,
        sprints: sprints.map((s) => ({ ...s, startDate: day(s.startDate), endDate: day(s.endDate) })),
        // Set them with update_card (fields: { name: value }); query them in search_cards ("Audience" = Managers).
        customFields: customFields.map((f) => ({ name: f.name, type: f.type, ...(f.type.endsWith("select") ? { options: (f.options as { label: string }[]).map((o) => o.label) } : {}), allBoards: f.allBoards })),
      };
    },
  );

  tool(
    server,
    "get_my_work",
    {
      title: "My work",
      description:
        "Everything waiting on you: reviews you need to decide, reviews you requested that are still open, your assigned cards and subtasks, and upcoming milestones.",
      input: {},
      kind: "read",
    },
    async () => {
      const me = (await getCurrentUser())!;
      const wsId = principal().workspaceId;
      const [projectVis, boardVis] = await Promise.all([projectVisibilityWhere(), boardVisibilityWhere()]);
      const inWs = { project: { workspaceId: wsId, ...projectVis } };
      const [toReview, requested, cards, subtasks, milestones] = await Promise.all([
        prisma.reviewCycle.findMany({
          where: { reviewerId: me.id, status: { in: ["requested", "in_review"] }, deliverable: inWs },
          orderBy: [{ dueDate: "asc" }],
          select: { roundId: true, round: true, status: true, dueDate: true, deliverable: { select: { id: true, name: true, project: { select: { name: true } } } } },
        }),
        prisma.reviewCycle.findMany({
          where: { requestedById: me.id, OR: [{ reviewerId: { not: me.id } }, { reviewerId: null }], status: { in: ["requested", "in_review"] }, deliverable: inWs },
          orderBy: [{ dueDate: "asc" }],
          select: {
            roundId: true, round: true, status: true, dueDate: true,
            reviewer: { select: { name: true, email: true } }, guest: { select: { name: true } },
            deliverable: { select: { id: true, name: true } },
          },
        }),
        prisma.card.findMany({
          where: { assignees: { some: { userId: me.id } }, column: { board: { workspaceId: wsId, ...boardVis } }, NOT: { status: { category: "done" } } },
          orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
          take: 100,
          select: { id: true, title: true, dueDate: true, keySeq: true, column: { select: { name: true, board: { select: { id: true, name: true, cardKeyPrefix: true } } } } },
        }),
        prisma.card.findMany({
          where: { parentCardId: { not: null }, done: false, assignees: { some: { userId: me.id } }, parentCard: { column: { board: { workspaceId: wsId, ...boardVis } } } },
          take: 100,
          select: { id: true, title: true, dueDate: true, parentCard: { select: { id: true, title: true, column: { select: { boardId: true } } } } },
        }),
        prisma.milestone.findMany({
          where: { completedAt: null, dueDate: { not: null }, project: { workspaceId: wsId, ...projectVis } },
          orderBy: { dueDate: "asc" },
          take: 10,
          select: { id: true, name: true, dueDate: true, project: { select: { id: true, name: true } } },
        }),
      ]);
      return {
        reviewsAwaitingYou: toReview.map((r) => ({
          roundId: r.roundId,
          round: r.round,
          status: r.status,
          due: day(r.dueDate),
          deliverable: r.deliverable.name,
          deliverableId: r.deliverable.id,
          project: r.deliverable.project.name,
          url: link(`/reviews/${r.roundId}`),
        })),
        reviewsYouAreWaitingOn: requested.map((r) => ({
          roundId: r.roundId,
          round: r.round,
          reviewer: r.reviewer ? (r.reviewer.name ?? r.reviewer.email) : r.guest ? `${r.guest.name} (guest)` : null,
          status: r.status,
          decided: isDecided(r.status),
          due: day(r.dueDate),
          deliverable: r.deliverable.name,
        })),
        yourCards: cards.map((c) => ({
          id: c.id,
          key: c.column?.board.cardKeyPrefix && c.keySeq ? `${c.column.board.cardKeyPrefix}-${c.keySeq}` : null,
          title: c.title,
          column: c.column?.name,
          board: c.column?.board.name,
          due: day(c.dueDate),
          url: cardHref(c.column!.board.id, c.id),
        })),
        yourSubtasks: subtasks.map((s) => ({
          id: s.id,
          title: s.title,
          due: day(s.dueDate),
          parent: { id: s.parentCard!.id, title: s.parentCard!.title },
          url: cardHref(s.parentCard!.column!.boardId, s.parentCard!.id),
        })),
        upcomingMilestones: milestones.map((m) => ({ id: m.id, name: m.name, due: day(m.dueDate), project: m.project })),
      };
    },
  );
}
