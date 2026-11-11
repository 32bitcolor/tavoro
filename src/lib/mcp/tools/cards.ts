import { getCardFields, setCardFieldValue } from "@/app/actions/custom-fields";
import { displayValue } from "@/lib/custom-fields";
import { commentSource } from "@/lib/comment-source";
import { addCardLink, getCardLinks, removeCardLink } from "@/app/actions/card-links";
import { getCardHistory, listWatchers, setWatching } from "@/app/actions/cards";
import { LINK_CHOICES } from "@/lib/card-links";
import { courseLine, createCourseForCard, findCourses, getCardCourse, linkCourse, unlinkCourse } from "@/lib/card-courses";
import { epicChildren, listEpics } from "@/lib/epics";
import { setCardEpic } from "@/app/actions/epics";
import { CARD_TYPES, PRIORITIES, asCardType } from "@/lib/card-fields";
import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { boardVisibilityWhere, getBoardForUser, getCardForUser } from "@/lib/authz";
import {
  createBoardNamed,
  createCard,
  createColumn,
  createProjectBoard,
  deleteCard,
  moveCard,
  moveCardToBoard,
  renameCard,
  setBoardCardKeyPrefix,
} from "@/app/actions/boards";
import {
  addComment,
  addSubtask,
  deleteSubtask,
  getCardDetail,
  setCardDueDate,
  setCardStartDate,
  setCardEstimate,
  setCardPriority,
  setCardType,
  toggleCardAssignee,
  toggleCardLabel,
  toggleCardSme,
  toggleSubtask,
  updateCardDescription,
} from "@/app/actions/cards";
import { assignCardToSprint } from "@/app/actions/sprints";
import { setCardPrivate } from "@/app/actions/board-share";
import { fromMarkdown, toMarkdown } from "@/lib/markdown";
import { check, day, link, parseDate, principal, resolveCardId, tool, ToolError } from "@/lib/mcp/util";
import { cardHref } from "@/lib/mcp/tools/workspace";

const cardRef = z.string().min(1).describe("Card id, or its key such as SEC-12");

const keyOf = (prefix: string | null | undefined, seq: number | null | undefined) => (prefix && seq != null ? `${prefix}-${seq}` : null);

/** A member by id, email or name (case-insensitive), in this workspace. */
export async function resolveMember(ref: string): Promise<{ id: string; name: string | null; email: string }> {
  const wsId = principal().workspaceId;
  const r = ref.trim();
  const members = await prisma.user.findMany({
    where: { memberships: { some: { workspaceId: wsId, suspendedAt: null } } },
    select: { id: true, name: true, email: true },
  });
  const hit =
    members.find((m) => m.id === r) ??
    members.find((m) => m.email.toLowerCase() === r.toLowerCase()) ??
    members.filter((m) => m.name?.toLowerCase() === r.toLowerCase()).at(0) ??
    (() => {
      const partial = members.filter((m) => m.name?.toLowerCase().includes(r.toLowerCase()));
      return partial.length === 1 ? partial[0] : undefined;
    })();
  if (!hit) throw new ToolError(`No workspace member matches "${ref}". get_workspace lists members.`);
  return hit;
}

/** A board column by id or name. */
async function resolveColumn(boardId: string, ref: string | undefined) {
  const columns = await prisma.column.findMany({ where: { boardId }, orderBy: { position: "asc" }, select: { id: true, name: true } });
  if (!columns.length) throw new ToolError("That board has no columns.");
  if (!ref) return columns[0];
  const hit = columns.find((c) => c.id === ref) ?? columns.find((c) => c.name.toLowerCase() === ref.trim().toLowerCase());
  if (!hit) throw new ToolError(`No column "${ref}" on this board. Columns: ${columns.map((c) => c.name).join(", ")}.`);
  return hit;
}

/** A board by id, name or card-key prefix, among those this member can see. */
async function resolveBoardRef(ref: string) {
  const boards = await prisma.board.findMany({
    where: { workspaceId: principal().workspaceId, ...(await boardVisibilityWhere()) },
    select: { id: true, name: true, cardKeyPrefix: true },
  });
  const r = ref.trim().toLowerCase();
  const hit =
    boards.find((b) => b.id === ref.trim()) ??
    boards.find((b) => b.name.toLowerCase() === r) ??
    boards.find((b) => b.cardKeyPrefix?.toLowerCase() === r);
  if (!hit) throw new ToolError(`No board "${ref}". Boards: ${boards.map((b) => b.name).join(", ")}.`);
  return hit;
}

async function resolveLabel(ref: string) {
  const labels = await prisma.label.findMany({ where: { workspaceId: principal().workspaceId }, select: { id: true, name: true } });
  const hit = labels.find((l) => l.id === ref) ?? labels.find((l) => l.name.toLowerCase() === ref.trim().toLowerCase());
  if (!hit) throw new ToolError(`No label "${ref}". Labels: ${labels.map((l) => l.name).join(", ") || "none yet"}.`);
  return hit;
}

async function resolveSprint(ref: string) {
  // Open sprints first, so a name shared with a completed sprint finds the open one.
  const sprints = (await prisma.sprint.findMany({ where: { workspaceId: principal().workspaceId }, select: { id: true, name: true, status: true } })).sort(
    (a, b) => Number(a.status === "completed") - Number(b.status === "completed"),
  );
  const hit =
    sprints.find((s) => s.id === ref) ??
    sprints.find((s) => s.name.toLowerCase() === ref.trim().toLowerCase()) ??
    (ref.trim().toLowerCase() === "active" ? sprints.find((s) => s.status === "active") : undefined);
  if (!hit) throw new ToolError(`No sprint "${ref}". Sprints: ${sprints.map((s) => s.name).join(", ") || "none"}.`);
  return hit;
}

/** The full card, as the card panel shows it. */
export async function loadCard(ref: string) {
  const cardId = await resolveCardId(ref);
  const d = await getCardDetail(cardId);
  if (!d) throw new ToolError("Card not found, or you can't see it.");
  const place = await prisma.card.findUniqueOrThrow({
    where: { id: cardId },
    select: {
      status: { select: { name: true, category: true } },
      column: { select: { name: true, board: { select: { name: true } } } },
      parentCard: { select: { column: { select: { board: { select: { name: true } } } } } },
    },
  });
  const member = new Map(d.members.map((m) => [m.id, m.name ?? m.email]));
  const label = new Map(d.workspaceLabels.map((l) => [l.id, l.name]));
  return {
    id: d.card.id,
    key: keyOf(d.boardCardKeyPrefix, d.card.keySeq),
    title: d.card.title,
    url: cardHref(d.boardId, d.isSubtask && d.parent ? d.parent.id : d.card.id),
    board: { id: d.boardId, name: place.column?.board.name ?? place.parentCard?.column?.board.name },
    column: place.column?.name ?? null,
    status: place.status?.name ?? null,
    done: d.cardDone,
    isSubtask: d.isSubtask,
    parent: d.parent,
    private: d.card.private,
    type: d.isSubtask ? "subtask" : d.card.type,
    priority: d.card.priority,
    estimate: d.card.estimate,
    estimateUnit: d.estimateUnit,
    epic: d.card.epic ? { id: d.card.epic.id, key: d.card.epic.key, title: d.card.epic.title } : null,
    due: day(d.card.dueDate ? new Date(d.card.dueDate) : null),
    description: toMarkdown(d.card.description),
    labels: d.card.labelIds.map((id) => label.get(id)).filter(Boolean),
    assignees: d.card.assigneeIds.map((id) => ({ id, name: member.get(id) })),
    smes: d.card.smeIds.map((id) => ({ id, name: member.get(id) })),
    sprint: d.card.sprintId ? (d.sprints.find((s) => s.id === d.card.sprintId)?.name ?? d.card.sprintId) : null,
    subtasks: d.subtasks.map((s) => ({
      id: s.id,
      key: keyOf(d.boardCardKeyPrefix, s.keySeq),
      title: s.title,
      done: s.done,
      due: s.dueDate ? s.dueDate.slice(0, 10) : null,
      assignees: s.assigneeIds.map((id) => member.get(id)),
    })),
    comments: d.comments.map((c) => ({ id: c.id, author: c.importedAuthor ? `${commentSource(c.importedAuthor, c.automation).name} (${commentSource(c.importedAuthor, c.automation).label})` : (c.author.name ?? c.author.email), at: c.createdAt, body: toMarkdown(c.body) })),
    attachments: d.attachments.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
    whiteboards: d.whiteboards.map((w) => ({ ...w, url: link(`/whiteboards/${w.id}`) })),
    reviewFeedback: d.reviewFeedback,
    ...(d.card.type === "epic" && !d.isSubtask ? { epicCards: await epicCardsFor(d.card.id) } : {}),
    ...(await linksAndWatchers(d.card.id, d.watching)),
    ...(await customFieldsOf(d.card.id, member)),
    ...(await courseOf(d.card.id)),
  };
}

/** The card's CourseForge course (docs/SUITE.md, step 2), as last synced. */
async function courseOf(cardId: string) {
  const r = await getCardCourse(cardId);
  if ("error" in r || !r.course) return {};
  const c = r.course;
  return { course: { id: c.courseId, title: c.title, url: c.summary?.url ?? `${c.app.url}/courses/${c.courseId}`, status: courseLine(c.summary, c.missing), syncedAt: c.syncedAt } };
}

/** The card's custom field values by field name (only the fields its board shows). */
async function customFieldsOf(cardId: string, member: Map<string, string>) {
  const { fields } = await getCardFields(cardId);
  if (!fields.length) return {};
  return { fields: Object.fromEntries(fields.map((f) => [f.name, f.type === "person" && f.value ? (member.get(String(f.value)) ?? String(f.value)) : displayValue(f, f.value)])) };
}

async function linksAndWatchers(cardId: string, watching: boolean) {
  const [{ links, hidden }, { watchers }] = await Promise.all([getCardLinks(cardId), listWatchers(cardId)]);
  return {
    links: links.map((l) => ({ linkId: l.id, relation: l.label, card: { id: l.other.id, key: l.other.key, title: l.other.title, status: l.other.status, done: l.other.done } })),
    ...(hidden ? { hiddenLinks: hidden } : {}),
    blocked: links.some((l) => l.label === "is blocked by" && !l.other.done),
    watchers: watchers.map((w) => w.name),
    youAreWatching: watching,
  };
}

/** An epic's cards (those the caller can see) and its progress. */
async function epicCardsFor(epicId: string) {
  const r = await epicChildren(epicId);
  return {
    progress: r.progress,
    cards: r.cards.map((c) => ({ id: c.id, key: c.key, title: c.title, type: c.type, status: c.status, done: c.done, board: c.boardName })),
    ...(r.hidden ? { hiddenCards: r.hidden } : {}),
  };
}

/** An epic by key, id or exact title. */
async function resolveEpicId(ref: string): Promise<string> {
  const r = ref.trim();
  const epics = await listEpics({ includeDone: true });
  const byTitle = epics.filter((e) => e.title.toLowerCase() === r.toLowerCase());
  if (byTitle.length === 1) return byTitle[0].id;
  if (byTitle.length > 1) throw new ToolError(`More than one epic is called "${r}"; use its key: ${byTitle.map((e) => e.key ?? e.id).join(", ")}.`);
  const id = await resolveCardId(r).catch(() => null);
  const hit = id ? epics.find((e) => e.id === id) : undefined;
  if (!hit) throw new ToolError(`No epic "${r}". Open epics: ${epics.filter((e) => !e.done).slice(0, 20).map((e) => e.key ? `${e.key} ${e.title}` : e.title).join("; ") || "none"}.`);
  return hit.id;
}

export async function loadBoard(boardId: string, includeDone: boolean) {
  const board = await getBoardForUser(boardId);
  if (!board) throw new ToolError("Board not found, or you can't see it.");
  const full = await prisma.board.findUniqueOrThrow({
    where: { id: boardId },
    select: {
      id: true,
      name: true,
      cardKeyPrefix: true,
      publicNonce: true,
      project: { select: { id: true, name: true } },
      columns: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          status: { select: { name: true, category: true } },
          cards: {
            orderBy: { position: "asc" },
            take: 200,
            select: {
              id: true,
              title: true,
              keySeq: true,
              dueDate: true,
              type: true,
              priority: true,
              estimate: true,
              epic: { select: { title: true } },
              status: { select: { category: true } },
              assignees: { select: { user: { select: { name: true, email: true } } } },
              labels: { select: { label: { select: { name: true } } } },
              subtasks: { select: { done: true } },
              sprint: { select: { name: true } },
              private: true,
            },
          },
        },
      },
    },
  });
  return {
    id: full.id,
    name: full.name,
    url: link(`/boards/${full.id}`),
    cardKeyPrefix: full.cardKeyPrefix,
    sharedPublicly: full.publicNonce !== null,
    project: full.project,
    columns: full.columns
      .filter((c) => includeDone || c.status?.category !== "done")
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status?.name ?? null,
        cards: c.cards.map((k) => ({
          id: k.id,
          key: keyOf(full.cardKeyPrefix, k.keySeq),
          title: k.title,
          type: asCardType(k.type),
          priority: k.priority ?? undefined,
          estimate: k.estimate ?? undefined,
          epic: k.epic?.title,
          due: day(k.dueDate),
          assignees: k.assignees.map((a) => a.user.name ?? a.user.email),
          labels: k.labels.map((l) => l.label.name),
          subtasks: k.subtasks.length ? `${k.subtasks.filter((s) => s.done).length}/${k.subtasks.length}` : undefined,
          sprint: k.sprint?.name,
          private: k.private || undefined,
        })),
      })),
  };
}

export function registerCardTools(server: McpServer) {
  tool(
    server,
    "find_courses",
    {
      title: "Find CourseForge courses",
      description:
        "Courses you can edit in the CourseForge connected to this workspace, newest first, with their status (draft / in review / live in an LMS), lessons, open review comments and problems. Use an id with link_course. You need to have signed in to CourseForge with Tavoro once.",
      input: { card: cardRef.describe("A card on a board in the workspace (the course is looked up for it)"), query: z.string().max(100).optional() },
      kind: "read",
    },
    async ({ card, query }) => {
      const id = await resolveCardId(card);
      const r = check(await findCourses(id, principal().userId, query ?? ""));
      return { courses: r.courses.map((c) => ({ id: c.id, title: c.title, url: c.url, status: courseLine(c, c.deleted), owner: c.owner, updatedAt: c.updatedAt })) };
    },
  );

  tool(
    server,
    "link_course",
    {
      title: "Link a card to a CourseForge course",
      description:
        "Attach a CourseForge course to a card (replacing any course it had). The card then shows the course and its live status, and the course shows the card in CourseForge. Give `course_id` from find_courses, or `create: true` to start a new blank course named after the card.",
      input: { card: cardRef, course_id: z.string().optional(), create: z.boolean().optional() },
      kind: "write",
    },
    async ({ card, course_id, create }) => {
      const id = await resolveCardId(card);
      if (!course_id && !create) throw new ToolError("Give course_id (from find_courses) or create: true.");
      check(create ? await createCourseForCard(id, principal().userId) : await linkCourse(id, principal().userId, course_id!));
      return loadCard(id);
    },
  );

  tool(
    server,
    "unlink_course",
    {
      title: "Unlink a card's CourseForge course",
      description: "Remove the course from a card. The course itself stays in CourseForge.",
      input: { card: cardRef },
      kind: "write",
    },
    async ({ card }) => {
      const id = await resolveCardId(card);
      check(await unlinkCourse(id, principal().userId));
      return loadCard(id);
    },
  );

  tool(
    server,
    "link_cards",
    {
      title: "Link two cards",
      description:
        "Link a card to another, read from `card`: blocks, blocked_by, relates, duplicates, duplicated_by, clones, cloned_by. A card blocked by one that isn't done shows as Blocked. Links can cross boards.",
      input: {
        card: cardRef,
        link: z.enum(LINK_CHOICES.map((c) => c.value) as unknown as ["blocks", "blocked_by", "relates", "duplicates", "duplicated_by", "clones", "cloned_by"]),
        other: cardRef.describe("The other card's id or key"),
      },
      kind: "write",
    },
    async ({ card, link, other }) => {
      const a = await resolveCardId(card);
      const b = await resolveCardId(other);
      check(await addCardLink(a, b, link));
      return loadCard(a);
    },
  );

  tool(
    server,
    "unlink_cards",
    {
      title: "Remove a link between cards",
      description: "Remove the link(s) between two cards. Give `relation` (as get_card shows it, e.g. 'is blocked by') to remove just that one.",
      input: { card: cardRef, other: cardRef.describe("The other card's id or key"), relation: z.string().optional() },
      kind: "destructive",
    },
    async ({ card, other, relation }) => {
      const a = await resolveCardId(card);
      const b = await resolveCardId(other);
      const { links } = await getCardLinks(a);
      const hits = links.filter((l) => l.other.id === b && (!relation || l.label === relation.trim().toLowerCase()));
      if (hits.length === 0) throw new ToolError("Those cards aren't linked" + (relation ? ` as "${relation}".` : "."));
      for (const l of hits) check(await removeCardLink(l.id));
      return loadCard(a);
    },
  );

  tool(
    server,
    "watch_card",
    {
      title: "Watch or stop watching a card",
      description: "Watchers are emailed when a card's status, assignee or priority changes, or someone comments.",
      input: { card: cardRef, watching: z.boolean() },
      kind: "write",
      idempotent: true,
    },
    async ({ card, watching }) => {
      const id = await resolveCardId(card);
      return check(await setWatching(id, watching));
    },
  );

  tool(
    server,
    "get_card_history",
    {
      title: "A card's history",
      description: "What changed on a card and who changed it, newest first: status, assignees, priority, estimate, type, due date, sprint, epic, links, title, board moves, description edits.",
      input: { card: cardRef, limit: z.number().int().min(1).max(500).default(50) },
      kind: "read",
    },
    async ({ card, limit }) => {
      const id = await resolveCardId(card);
      if (!(await getCardForUser(id))) throw new ToolError("Card not found, or you can't see it.");
      const { entries } = await getCardHistory(id, limit);
      return { history: entries.map((e) => ({ at: e.at, who: e.actor, what: e.text })) };
    },
  );

  tool(
    server,
    "list_epics",
    {
      title: "List epics",
      description:
        "Epics in the workspace: big pieces of work that group cards from any board. Each has a key, title, home board, status and progress (done / total cards). Done epics are left out unless include_done is true. Put a card in an epic with update_card (epic).",
      input: { include_done: z.boolean().default(false) },
      kind: "read",
    },
    async ({ include_done }) => ({
      epics: (await listEpics({ includeDone: include_done })).map((e) => ({
        id: e.id,
        key: e.key,
        title: e.title,
        board: e.boardName,
        status: e.status,
        progress: e.progress,
        url: cardHref(e.boardId, e.id),
      })),
    }),
  );

  tool(
    server,
    "list_boards",
    { title: "List boards", description: "Every board you can see in the workspace, with its project and card count.", input: {}, kind: "read" },
    async () => {
      const boards = await prisma.board.findMany({
        where: { workspaceId: principal().workspaceId, ...(await boardVisibilityWhere()) },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          cardKeyPrefix: true,
          project: { select: { id: true, name: true } },
          columns: { select: { _count: { select: { cards: true } } } },
        },
      });
      return boards.map((b) => ({
        id: b.id,
        name: b.name,
        cardKeyPrefix: b.cardKeyPrefix,
        project: b.project,
        cards: b.columns.reduce((n, c) => n + c._count.cards, 0),
        url: link(`/boards/${b.id}`),
      }));
    },
  );

  tool(
    server,
    "get_board",
    {
      title: "Get a board",
      description: "A board's columns and their cards (key, title, type, priority, estimate, epic, due date, assignees, labels, subtask progress, sprint).",
      input: {
        board_id: z.string().min(1),
        include_done: z.boolean().default(true).describe("Include columns whose status is done"),
      },
      kind: "read",
    },
    ({ board_id, include_done }) => loadBoard(board_id, include_done),
  );

  tool(
    server,
    "get_card",
    {
      title: "Get a card",
      description:
        "Everything on a card: type, priority, estimate, epic (and, on an epic, its cards and progress), links to other cards, whether it's blocked, watchers, description (Markdown), status, due date, labels, assignees, SMEs, sprint, subtasks, comments, attachments, and any review comments it was made from.",
      input: { card: cardRef },
      kind: "read",
    },
    ({ card }) => loadCard(card),
  );

  tool(
    server,
    "create_board",
    {
      title: "Create a board",
      description: "A new board with To do / In progress / Done columns, optionally belonging to a project and numbering its cards (prefix like WP gives WP-1, WP-2…).",
      input: {
        name: z.string().min(1).max(120),
        project_id: z.string().optional(),
        card_key_prefix: z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,7}$/).optional().describe("2–8 letters/numbers"),
      },
      kind: "write",
    },
    async ({ name, project_id, card_key_prefix }) => {
      let boardId: string;
      if (project_id) {
        boardId = check(await createProjectBoard(project_id, name)).board.id;
        if (card_key_prefix) check(await setBoardCardKeyPrefix(boardId, card_key_prefix));
      } else {
        boardId = check(await createBoardNamed(name, card_key_prefix ?? null)).board.id;
      }
      return loadBoard(boardId, true);
    },
  );

  tool(
    server,
    "create_column",
    { title: "Add a board column", description: "Add a column to the end of a board.", input: { board_id: z.string().min(1), name: z.string().min(1).max(120) }, kind: "write" },
    async ({ board_id, name }) => {
      check(await createColumn(board_id, name));
      return loadBoard(board_id, true);
    },
  );

  tool(
    server,
    "create_card",
    {
      title: "Create a card",
      description:
        "Add a card to a board. Optionally set its column (default: the first), type, priority, estimate, epic, description (Markdown), due date, assignees, SMEs, labels and sprint in the same call.",
      input: {
        board_id: z.string().min(1),
        title: z.string().min(1).max(280),
        column: z.string().optional().describe("Column name or id; defaults to the board's first column"),
        description: z.string().max(50000).optional().describe("Markdown"),
        due: z.string().optional().describe("YYYY-MM-DD"),
        assignees: z.array(z.string()).max(20).optional().describe("Member ids, emails or names"),
        smes: z.array(z.string()).max(20).optional().describe("Subject-matter experts: member ids, emails or names"),
        labels: z.array(z.string()).max(20).optional().describe("Existing label names or ids"),
        sprint: z.string().optional().describe("Sprint name or id, or 'active'"),
        type: z.enum(CARD_TYPES).optional().describe("task, bug, story or epic (top-level cards only; an epic can't be in a sprint)"),
        priority: z.enum([...PRIORITIES, "none"]).optional().describe("highest, high, medium, low, lowest, or none"),
        estimate: z.number().min(0).max(10000).nullable().optional().describe("Story points or hours (see estimateUnit on the card); null clears it"),
        epic: z.string().optional().describe("The epic this card belongs to: its key, id or exact title; empty string takes it out of its epic"),
      },
      kind: "write",
    },
    async (a) => {
      if (!(await getBoardForUser(a.board_id))) throw new ToolError("Board not found, or you can't see it.");
      const column = await resolveColumn(a.board_id, a.column);
      if (a.type === "epic" && a.sprint?.trim()) throw new ToolError("An epic can't be in a sprint; its cards are.");
      if (a.type === "epic" && a.epic?.trim()) throw new ToolError("An epic can't be in another epic.");
      // Resolve the epic before creating anything, so a bad reference leaves nothing behind.
      const epicId = a.epic?.trim() ? await resolveEpicId(a.epic) : undefined;
      const { card } = check(await createCard(column.id, a.title));
      const { epic: _epic, ...rest } = a;
      void _epic;
      await applyCardChanges(card.id, { ...rest, epicId });
      return loadCard(card.id);
    },
  );

  tool(
    server,
    "update_card",
    {
      title: "Update a card",
      description:
        "Change a card: title, description (Markdown, replaces the old one), due date and start date (empty string clears them), custom fields (by name), column (moves it), board (moves it to another board, into \`column\` there or its first column; its key changes and the old key keeps resolving), assignees, SMEs, labels, sprint, type, priority, estimate, epic, private (true leaves it off the board's public link; top-level cards only). Lists add or remove people/labels; anything you leave out stays as it is.",
      input: {
        card: cardRef,
        title: z.string().min(1).max(280).optional(),
        description: z.string().max(50000).optional().describe("Markdown; replaces the description"),
        due: z.string().optional().describe("YYYY-MM-DD, or empty to clear"),
        start: z.string().optional().describe("Start date, YYYY-MM-DD, or empty to clear (the roadmap draws epics from start to due)"),
        fields: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]))
          .optional()
          .describe("Custom fields by name: text, a number, YYYY-MM-DD, true/false, an option's label (or a list for multi-select), or a person (name or email). null clears."),
        column: z.string().optional().describe("Move to this column (name or id), at the bottom"),
        board: z.string().optional().describe("Move to another board (name, id or key prefix); column then names a column on that board"),
        add_assignees: z.array(z.string()).max(20).optional(),
        remove_assignees: z.array(z.string()).max(20).optional(),
        add_smes: z.array(z.string()).max(20).optional(),
        remove_smes: z.array(z.string()).max(20).optional(),
        add_labels: z.array(z.string()).max(20).optional(),
        remove_labels: z.array(z.string()).max(20).optional(),
        sprint: z.string().optional().describe("Sprint name or id, 'active', or empty to take it out of its sprint"),
        private: z.boolean().optional().describe("true hides the card from the board's public read-only link"),
        type: z.enum(CARD_TYPES).optional().describe("task, bug, story or epic (top-level cards only; an epic can't be in a sprint)"),
        priority: z.enum([...PRIORITIES, "none"]).optional().describe("highest, high, medium, low, lowest, or none"),
        estimate: z.number().min(0).max(10000).nullable().optional().describe("Story points or hours (see estimateUnit on the card); null clears it"),
        epic: z.string().optional().describe("The epic this card belongs to: its key, id or exact title; empty string takes it out of its epic"),
      },
      kind: "write",
      idempotent: true,
    },
    async (a) => {
      const cardId = await resolveCardId(a.card);
      const access = await getCardForUser(cardId);
      if (!access) throw new ToolError("Card not found, or you can't see it.");
      if (a.title) check(await renameCard(cardId, a.title));
      const toBoard = a.board ? await resolveBoardRef(a.board) : null;
      if (toBoard && toBoard.id !== access.boardId) {
        if (access.parentCardId) throw new ToolError("Subtasks move with their card; move the parent card instead.");
        const col = await resolveColumn(toBoard.id, a.column);
        check(await moveCardToBoard(cardId, col.id));
      } else if (a.column) {
        if (access.parentCardId) throw new ToolError("Subtasks don't live in columns; move the parent card instead.");
        const col = await resolveColumn(access.boardId, a.column);
        const count = await prisma.card.count({ where: { columnId: col.id, NOT: { id: cardId } } });
        check(await moveCard(cardId, col.id, count));
      }
      if (a.private !== undefined) check(await setCardPrivate(cardId, a.private));
      await applyCardChanges(cardId, {
        description: a.description,
        due: a.due,
        start: a.start,
        fields: a.fields,
        assignees: a.add_assignees,
        removeAssignees: a.remove_assignees,
        smes: a.add_smes,
        removeSmes: a.remove_smes,
        labels: a.add_labels,
        removeLabels: a.remove_labels,
        sprint: a.sprint,
        type: a.type,
        priority: a.priority,
        estimate: a.estimate,
        epicId: a.epic === undefined ? undefined : a.epic.trim() ? await resolveEpicId(a.epic) : null,
      });
      return loadCard(cardId);
    },
  );

  tool(
    server,
    "add_card_comment",
    {
      title: "Comment on a card",
      description: "Post a comment (Markdown) on a card, as you. @-mentions aren't sent from here.",
      input: { card: cardRef, body: z.string().min(1).max(20000).describe("Markdown") },
      kind: "write",
    },
    async ({ card, body }) => {
      const cardId = await resolveCardId(card);
      const res = check(await addComment(cardId, fromMarkdown(body)!));
      return { ok: true, commentId: res.comment?.id, url: (await loadCard(cardId)).url };
    },
  );

  tool(
    server,
    "add_subtasks",
    {
      title: "Add subtasks",
      description: "Add one or more subtasks (checklist items) to a card.",
      input: { card: cardRef, titles: z.array(z.string().min(1).max(280)).min(1).max(50) },
      kind: "write",
    },
    async ({ card, titles }) => {
      const cardId = await resolveCardId(card);
      for (const t of titles) check(await addSubtask(cardId, t));
      return loadCard(cardId);
    },
  );

  tool(
    server,
    "set_subtask_done",
    {
      title: "Tick or untick a subtask",
      description: "Mark a subtask done or not done.",
      input: { subtask: cardRef.describe("Subtask id or key"), done: z.boolean() },
      kind: "write",
      idempotent: true,
    },
    async ({ subtask, done }) => {
      const id = await resolveCardId(subtask);
      const access = await getCardForUser(id);
      if (!access?.parentCardId) throw new ToolError("That isn't a subtask.");
      check(await toggleSubtask(id, done));
      return { ok: true, subtask: id, done };
    },
  );

  tool(
    server,
    "delete_card",
    {
      title: "Delete a card or subtask",
      description: "Permanently delete a card (with its subtasks, comments and attachments) or a single subtask. Cannot be undone.",
      input: { card: cardRef },
      kind: "destructive",
    },
    async ({ card }) => {
      const id = await resolveCardId(card);
      const access = await getCardForUser(id);
      if (!access) throw new ToolError("Card not found, or you can't see it.");
      check(access.parentCardId ? await deleteSubtask(id) : await deleteCard(id));
      return { ok: true, deleted: id };
    },
  );
}

type CardChanges = {
  description?: string;
  due?: string;
  start?: string;
  fields?: Record<string, string | number | boolean | string[] | null>;
  assignees?: string[];
  removeAssignees?: string[];
  smes?: string[];
  removeSmes?: string[];
  labels?: string[];
  removeLabels?: string[];
  sprint?: string;
  type?: string;
  priority?: string;
  estimate?: number | null;
  /** undefined = leave it; null = take it out of its epic. */
  epicId?: string | null;
};

async function applyCardChanges(cardId: string, c: CardChanges) {
  // Type first: an epic leaves its sprint, and a sprint can't then be set on it.
  if (c.type !== undefined) check(await setCardType(cardId, c.type));
  if (c.priority !== undefined) check(await setCardPriority(cardId, c.priority === "none" ? null : c.priority));
  if (c.estimate !== undefined) check(await setCardEstimate(cardId, c.estimate));
  if (c.epicId !== undefined) check(await setCardEpic(cardId, c.epicId));
  if (c.description !== undefined) check(await updateCardDescription(cardId, fromMarkdown(c.description)));
  if (c.due !== undefined) check(await setCardDueDate(cardId, parseDate(c.due)));
  if (c.start !== undefined) check(await setCardStartDate(cardId, parseDate(c.start)));
  if (c.fields) {
    const { fields } = await getCardFields(cardId);
    for (const [name, value] of Object.entries(c.fields)) {
      const f = fields.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
      if (!f) throw new ToolError(`No field "${name}" on this card's board. Fields: ${fields.map((x) => x.name).join(", ") || "none"}.`);
      const v = f.type === "person" && typeof value === "string" ? (await resolveMember(value)).id : value;
      check(await setCardFieldValue(cardId, f.id, v));
    }
  }
  for (const r of c.assignees ?? []) check(await toggleCardAssignee(cardId, (await resolveMember(r)).id, true));
  for (const r of c.removeAssignees ?? []) check(await toggleCardAssignee(cardId, (await resolveMember(r)).id, false));
  for (const r of c.smes ?? []) check(await toggleCardSme(cardId, (await resolveMember(r)).id, true));
  for (const r of c.removeSmes ?? []) check(await toggleCardSme(cardId, (await resolveMember(r)).id, false));
  for (const r of c.labels ?? []) check(await toggleCardLabel(cardId, (await resolveLabel(r)).id, true));
  for (const r of c.removeLabels ?? []) check(await toggleCardLabel(cardId, (await resolveLabel(r)).id, false));
  if (c.sprint !== undefined) check(await assignCardToSprint(cardId, c.sprint.trim() ? (await resolveSprint(c.sprint)).id : null));
}

export { resolveSprint };
