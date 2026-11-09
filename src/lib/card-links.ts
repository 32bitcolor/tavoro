// Links between cards (docs/JIRA-PARITY.md). A link is stored once, read from `from`
// ("SEC-1 blocks SEC-2"), and shown from both sides with the inverse wording.
// Jira's four default link types, so an import maps one to one.

export const LINK_TYPES = ["blocks", "relates", "duplicates", "clones"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

/** How the link reads from the `from` card, and from the `to` card. */
export const LINK_WORDING: Record<LinkType, { out: string; in: string }> = {
  blocks: { out: "blocks", in: "is blocked by" },
  relates: { out: "relates to", in: "relates to" },
  duplicates: { out: "duplicates", in: "is duplicated by" },
  clones: { out: "clones", in: "is cloned by" },
};

/** The choices in the "Link a card" picker: each type, from this card's point of view. */
export const LINK_CHOICES = [
  { value: "blocks", type: "blocks", outward: true, label: "blocks" },
  { value: "blocked_by", type: "blocks", outward: false, label: "is blocked by" },
  { value: "relates", type: "relates", outward: true, label: "relates to" },
  { value: "duplicates", type: "duplicates", outward: true, label: "duplicates" },
  { value: "duplicated_by", type: "duplicates", outward: false, label: "is duplicated by" },
  { value: "clones", type: "clones", outward: true, label: "clones" },
  { value: "cloned_by", type: "clones", outward: false, label: "is cloned by" },
] as const satisfies readonly { value: string; type: LinkType; outward: boolean; label: string }[];
export type LinkChoice = (typeof LINK_CHOICES)[number]["value"];

export function isLinkChoice(v: string): v is LinkChoice {
  return LINK_CHOICES.some((c) => c.value === v);
}

/** Store order for a link from `self` with a choice: who's `from` and who's `to`. */
export function orientLink(selfId: string, otherId: string, choice: LinkChoice): { fromId: string; toId: string; type: LinkType } {
  const c = LINK_CHOICES.find((x) => x.value === choice)!;
  if (c.type === "relates") {
    const [a, b] = selfId < otherId ? [selfId, otherId] : [otherId, selfId];
    return { fromId: a, toId: b, type: "relates" };
  }
  return c.outward ? { fromId: selfId, toId: otherId, type: c.type } : { fromId: otherId, toId: selfId, type: c.type };
}

/** The wording for a link as seen from `selfId`. */
export function linkLabel(link: { fromId: string; type: string }, selfId: string): string {
  const w = LINK_WORDING[(LINK_TYPES as readonly string[]).includes(link.type) ? (link.type as LinkType) : "relates"];
  return link.fromId === selfId ? w.out : w.in;
}
