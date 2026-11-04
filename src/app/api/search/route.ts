import { getCurrentUser, getActiveMembership } from "@/lib/dal";
import { prisma } from "@/lib/db";
import {
  boardVisibilityWhere,
  projectVisibilityWhere,
  storyboardVisibilityWhere,
  whiteboardVisibilityWhere,
  resolveCardKey,
} from "@/lib/authz";

const TAKE = 5;

// A card key looks like "WP-5" (board prefix + sequence). Same shape the
// /c/<key> short link accepts, so search resolves whatever that link resolves.
const CARD_KEY_RE = /^([A-Za-z][A-Za-z0-9]{1,7})-(\d+)$/;

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const membership = await getActiveMembership();
  if (!membership) return Response.json({ results: [] });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ results: [] });

  const wsId = membership.workspaceId;
  const contains = { contains: q, mode: "insensitive" as const };
  const keyMatch = CARD_KEY_RE.exec(q);

  const [keyHit, boards, projects, storyboards, whiteboards, content, cards] = await Promise.all([
    keyMatch ? resolveCardKey(keyMatch[1], Number(keyMatch[2])) : Promise.resolve(null),
    prisma.board.findMany({
      where: { workspaceId: wsId, name: contains, ...(await boardVisibilityWhere()) },
      select: { id: true, name: true },
      take: TAKE,
    }),
    prisma.project.findMany({
      where: { workspaceId: wsId, name: contains, ...(await projectVisibilityWhere()) },
      select: { id: true, name: true },
      take: TAKE,
    }),
    prisma.storyboard.findMany({
      where: { workspaceId: wsId, title: contains, ...(await storyboardVisibilityWhere()) },
      select: { id: true, title: true },
      take: TAKE,
    }),
    prisma.whiteboard.findMany({
      where: { workspaceId: wsId, title: contains, ...(await whiteboardVisibilityWhere()) },
      select: { id: true, title: true },
      take: TAKE,
    }),
    // The content inventory is workspace-wide (no group grants); retired items included,
    // so "did we ever ship X?" still finds it.
    prisma.contentItem.findMany({
      where: { workspaceId: wsId, title: contains },
      select: { id: true, title: true },
      take: TAKE,
    }),
    // Cards and subtasks alike — a subtask is just a Card with parentCardId
    // set, reached through its parent's column instead of its own (it has
    // none). Both open the same board with the card's drawer deep-linked.
    prisma.card.findMany({
      where: {
        title: contains,
        OR: [
          { columnId: { not: null }, column: { board: { workspaceId: wsId, ...(await boardVisibilityWhere()) } } },
          {
            parentCardId: { not: null },
            parentCard: { column: { board: { workspaceId: wsId, ...(await boardVisibilityWhere()) } } },
          },
        ],
      },
      select: {
        id: true,
        title: true,
        parentCardId: true,
        column: { select: { boardId: true } },
        parentCard: { select: { column: { select: { boardId: true } } } },
      },
      take: TAKE,
    }),
  ]);

  // An exact card-key match goes first; drop it from the title matches so the
  // same card isn't listed twice.
  const keyResult = keyHit
    ? [{
        type: keyHit.isSubtask ? ("subtask" as const) : ("card" as const),
        id: keyHit.cardId,
        label: keyHit.title,
        href: `/boards/${keyHit.boardId}?card=${keyHit.cardId}`,
      }]
    : [];

  const results = [
    ...keyResult,
    ...boards.map((b) => ({ type: "board" as const, id: b.id, label: b.name, href: `/boards/${b.id}` })),
    ...projects.map((p) => ({ type: "project" as const, id: p.id, label: p.name, href: `/projects/${p.id}` })),
    ...storyboards.map((s) => ({ type: "storyboard" as const, id: s.id, label: s.title, href: `/storyboards/${s.id}` })),
    ...whiteboards.map((w) => ({ type: "whiteboard" as const, id: w.id, label: w.title, href: `/whiteboards/${w.id}` })),
    ...content.map((c) => ({ type: "content" as const, id: c.id, label: c.title, href: `/content/${c.id}` })),
    ...cards
      .filter((c) => c.id !== keyHit?.cardId)
      .map((c) => {
        const boardId = c.column?.boardId ?? c.parentCard!.column!.boardId;
        const type: "card" | "subtask" = c.parentCardId ? "subtask" : "card";
        return { type, id: c.id, label: c.title, href: `/boards/${boardId}?card=${c.id}` };
      }),
  ];

  return Response.json({ results });
}
