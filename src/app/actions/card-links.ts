"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { boardVisibilityWhere, getCardForUser } from "@/lib/authz";
import { getActiveMembership, getCurrentUser } from "@/lib/dal";
import { recordActivity } from "@/lib/card-activity";
import { LINK_WORDING, isLinkChoice, linkLabel, orientLink, type LinkType } from "@/lib/card-links";

// Links between cards (docs/JIRA-PARITY.md): blocks, relates, duplicates, clones.
// Both cards must be visible to the caller and in the same workspace.

const CARD_SELECT = {
  id: true,
  title: true,
  keySeq: true,
  type: true,
  status: { select: { name: true, category: true } },
  column: { select: { board: { select: { id: true, workspaceId: true, cardKeyPrefix: true } } } },
  parentCard: { select: { column: { select: { board: { select: { id: true, workspaceId: true, cardKeyPrefix: true } } } } } },
} as const;

type CardRow = {
  id: string;
  title: string;
  keySeq: number | null;
  type: string;
  status: { name: string; category: string } | null;
  column: { board: { id: string; workspaceId: string; cardKeyPrefix: string | null } } | null;
  parentCard: { column: { board: { id: string; workspaceId: string; cardKeyPrefix: string | null } } | null } | null;
};

function boardOf(c: CardRow) {
  return c.column?.board ?? c.parentCard?.column?.board ?? null;
}

function view(c: CardRow) {
  const b = boardOf(c);
  return {
    id: c.id,
    title: c.title,
    key: b?.cardKeyPrefix && c.keySeq != null ? `${b.cardKeyPrefix}-${c.keySeq}` : null,
    type: c.type,
    boardId: b?.id ?? "",
    status: c.status?.name ?? null,
    done: c.status?.category === "done",
  };
}

/** "SEC-3 Welcome video" — how a card is named in History. */
function nameOf(c: CardRow) {
  const v = view(c);
  return v.key ? `${v.key} ${v.title}` : v.title;
}

/** A card's links, from its point of view. Links to cards the caller can't see are counted, not shown. */
export async function getCardLinks(cardId: string) {
  const access = await getCardForUser(cardId);
  if (!access) return { links: [], hidden: 0 };
  const rows = await prisma.cardLink.findMany({
    where: { OR: [{ fromId: cardId }, { toId: cardId }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, fromId: true, toId: true, type: true, from: { select: CARD_SELECT }, to: { select: CARD_SELECT } },
  });
  const links = [];
  let hidden = 0;
  for (const r of rows) {
    const otherId = r.fromId === cardId ? r.toId : r.fromId;
    if (!(await getCardForUser(otherId))) {
      hidden++;
      continue;
    }
    const other = (r.fromId === cardId ? r.to : r.from) as CardRow;
    links.push({ id: r.id, type: r.type as LinkType, label: linkLabel(r, cardId), other: view(other) });
  }
  return { links, hidden };
}

/** Link this card to another. `choice` reads from this card: "blocks", "blocked_by", "relates", … */
export async function addCardLink(cardId: string, otherId: string, choice: string) {
  if (!isLinkChoice(choice)) return { error: "Unknown link type." };
  if (cardId === otherId) return { error: "A card can’t be linked to itself." };
  const [a, b] = await Promise.all([getCardForUser(cardId), getCardForUser(otherId)]);
  if (!a || !b) return { error: "Card not found." };
  const [ca, cb] = (await Promise.all([
    prisma.card.findUnique({ where: { id: cardId }, select: CARD_SELECT }),
    prisma.card.findUnique({ where: { id: otherId }, select: CARD_SELECT }),
  ])) as [CardRow | null, CardRow | null];
  if (!ca || !cb || boardOf(ca)?.workspaceId !== boardOf(cb)?.workspaceId) return { error: "Card not found." };

  const { fromId, toId, type } = orientLink(cardId, otherId, choice);
  const exists = await prisma.cardLink.findUnique({ where: { fromId_toId_type: { fromId, toId, type } }, select: { id: true } });
  if (exists) return { error: "Those cards are already linked that way." };
  const me = await getCurrentUser();
  const link = await prisma.cardLink.create({ data: { fromId, toId, type, createdById: me?.id ?? null }, select: { id: true, fromId: true, type: true } });

  // History on both cards, each from its own side.
  await recordActivity(cardId, me?.id, "link", { added: `${linkLabel(link, cardId)} ${nameOf(cb)}` });
  await recordActivity(otherId, me?.id, "link", { added: `${linkLabel(link, otherId)} ${nameOf(ca)}` });
  revalidatePath(`/boards/${a.boardId}`);
  if (b.boardId !== a.boardId) revalidatePath(`/boards/${b.boardId}`);
  return { link: { id: link.id, type, label: linkLabel(link, cardId), other: view(cb) } };
}

export async function removeCardLink(linkId: string) {
  const row = await prisma.cardLink.findUnique({
    where: { id: linkId },
    select: { id: true, fromId: true, toId: true, type: true, from: { select: CARD_SELECT }, to: { select: CARD_SELECT } },
  });
  if (!row) return { error: "Link not found." };
  // Seeing either card is enough to remove a link from it.
  const [a, b] = await Promise.all([getCardForUser(row.fromId), getCardForUser(row.toId)]);
  if (!a && !b) return { error: "Link not found." };
  await prisma.cardLink.delete({ where: { id: linkId } });
  const me = await getCurrentUser();
  await recordActivity(row.fromId, me?.id, "link", { removed: `${LINK_WORDING[row.type as LinkType]?.out ?? "relates to"} ${nameOf(row.to as CardRow)}` });
  await recordActivity(row.toId, me?.id, "link", { removed: `${LINK_WORDING[row.type as LinkType]?.in ?? "relates to"} ${nameOf(row.from as CardRow)}` });
  if (a) revalidatePath(`/boards/${a.boardId}`);
  if (b && b.boardId !== a?.boardId) revalidatePath(`/boards/${b.boardId}`);
  return { ok: true as const };
}

/** Cards the caller can see that this card could link to: title or key ("SEC-12"). */
export async function searchLinkCandidates(cardId: string, query: string) {
  const access = await getCardForUser(cardId);
  const m = await getActiveMembership();
  if (!access || !m) return { cards: [] };
  const q = query.trim().slice(0, 100);
  const keyMatch = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d+)$/.exec(q);
  const visible = { workspaceId: m.workspaceId, ...(await boardVisibilityWhere()) };
  const rows = await prisma.card.findMany({
    where: {
      id: { not: cardId },
      OR: [{ column: { board: visible } }, { parentCard: { column: { board: visible } } }],
      ...(keyMatch
        ? { keySeq: Number(keyMatch[2]), AND: [{ OR: [{ column: { board: { cardKeyPrefix: { equals: keyMatch[1], mode: "insensitive" } } } }, { parentCard: { column: { board: { cardKeyPrefix: { equals: keyMatch[1], mode: "insensitive" } } } } }] }] }
        : q
          ? { title: { contains: q, mode: "insensitive" } }
          : { columnId: { not: null } }),
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: CARD_SELECT,
  });
  return { cards: (rows as CardRow[]).map(view) };
}
