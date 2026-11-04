import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import {
  boardVisibilityWhere,
  getDeliverableForUser,
  projectVisibilityWhere,
  resolveCardKey,
  storyboardVisibilityWhere,
  whiteboardVisibilityWhere,
} from "@/lib/authz";
import { ticketLabel } from "@/lib/intake";
import { link, principal, resolveCardId, tool, ToolError } from "@/lib/mcp/util";
import { loadBoard, loadCard } from "@/lib/mcp/tools/cards";
import { loadProject } from "@/lib/mcp/tools/projects";
import { loadStoryboard } from "@/lib/mcp/tools/storyboards";
import { loadWhiteboard } from "@/lib/mcp/tools/whiteboards";
import { loadRound } from "@/lib/mcp/tools/reviews";
import { loadIntake } from "@/lib/mcp/tools/planning";
import { loadContent } from "@/lib/mcp/tools/content";

// The search/fetch pair (docs/MCP.md). This is the shape ChatGPT's deep research and
// company knowledge expect — search(query) → { results: [{ id, title, url }] } and
// fetch(id) → { id, title, text, url, metadata } — and it suits any assistant that
// wants whole documents. Ids are "<type>:<id>" (card:…, project:…, board:…,
// storyboard:…, deliverable:…, review:…, intake:…, whiteboard:…, content:…). The detailed get_* tools remain.

type Doc = { id: string; title: string; text: string; url: string; metadata: Record<string, string> };

const lines = (...xs: (string | false | null | undefined)[]) => xs.filter((x) => x !== false && x != null).join("\n");
const bullet = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "_none_");

async function cardDoc(ref: string): Promise<Doc> {
  const c = await loadCard(ref);
  return {
    id: `card:${c.id}`,
    title: `${c.key ? `${c.key} · ` : ""}${c.title}`,
    url: c.url,
    metadata: { type: "card", board: String(c.board.name ?? ""), status: String(c.status ?? c.column ?? "") },
    text: lines(
      `# ${c.key ? `${c.key}: ` : ""}${c.title}`,
      "",
      `Board: ${c.board.name ?? ""} · Column: ${c.column ?? "—"} · Status: ${c.status ?? "—"}${c.done ? " (done)" : ""}`,
      `Due: ${c.due ?? "—"} · Sprint: ${c.sprint ?? "—"}`,
      `Assignees: ${c.assignees.map((a) => a.name).join(", ") || "—"} · SMEs: ${c.smes.map((a) => a.name).join(", ") || "—"}`,
      `Labels: ${c.labels.join(", ") || "—"}`,
      "",
      "## Description",
      c.description || "_No description._",
      "",
      `## Subtasks`,
      bullet(c.subtasks.map((s) => `[${s.done ? "x" : " "}] ${s.key ? `${s.key} ` : ""}${s.title}`)),
      "",
      "## Comments",
      c.comments.length ? c.comments.map((m) => `**${m.author}** (${m.at.slice(0, 10)}):\n${m.body}`).join("\n\n") : "_none_",
      c.reviewFeedback.length ? `\n## From review comments\n${bullet(c.reviewFeedback.map((f) => `Round ${f.roundNumber} of ${f.deliverableName}, ${f.author} [${f.status}]: ${f.excerpt}`))}` : null,
    ),
  };
}

async function projectDoc(id: string): Promise<Doc> {
  const p = await loadProject(id);
  return {
    id: `project:${p.id}`,
    title: p.name,
    url: p.url,
    metadata: { type: "project", methodology: p.methodology, status: p.status },
    text: lines(
      `# ${p.name}`,
      "",
      `${p.methodology} project · ${p.status} · ${p.hoursLogged} h logged`,
      p.description ? `\n${p.description}` : null,
      "",
      "## Phases",
      bullet(p.phases.map((x) => `${x.name}: ${x.status.replace("_", " ")}${x.startDate ? ` (${x.startDate} → ${x.endDate ?? "?"})` : ""}`)),
      "",
      "## Deliverables",
      bullet(
        p.deliverables.map(
          (d) =>
            `${d.name} (${d.type}, ${d.status.replace("_", " ")}${d.phase ? `, ${d.phase}` : ""})` +
            (d.latestReview ? ` — review round ${d.latestReview.round}: ${d.latestReview.outcome.replace("_", " ")}, ${d.latestReview.openComments} open comments` : ""),
        ),
      ),
      "",
      "## Milestones",
      bullet(p.milestones.map((m) => `${m.completed ? "[x]" : "[ ]"} ${m.name}${m.due ? ` — due ${m.due}` : ""}`)),
      "",
      "## Learning objectives",
      bullet(p.objectives.map((o) => `${o.text} (${o.bloomLevel}; taught on ${o.taughtOnScreens} screens, assessed by ${o.assessedByItems} items)`)),
      "",
      "## Assessment items",
      bullet(p.assessmentItems.map((i) => `${i.prompt} (${i.type.replace("_", " ")})`)),
    ),
  };
}

async function boardDoc(id: string): Promise<Doc> {
  const b = await loadBoard(id, true);
  return {
    id: `board:${b.id}`,
    title: b.name,
    url: b.url,
    metadata: { type: "board", project: b.project?.name ?? "" },
    text: lines(
      `# ${b.name}`,
      b.project ? `Project: ${b.project.name}` : "Standalone board",
      ...b.columns.map((c) =>
        lines(
          "",
          `## ${c.name} (${c.cards.length})`,
          bullet(c.cards.map((k) => `${k.key ? `${k.key} ` : ""}${k.title}${k.due ? ` — due ${k.due}` : ""}${k.assignees.length ? ` — ${k.assignees.join(", ")}` : ""}`)),
        ),
      ),
    ),
  };
}

const FIELD_TITLES: [string, string][] = [
  ["on_screen_text", "On-screen text"],
  ["narration", "Narration"],
  ["visuals", "Visuals"],
  ["interaction", "Interaction"],
  ["developer_notes", "Developer notes"],
];

async function storyboardDoc(id: string): Promise<Doc> {
  const s = await loadStoryboard(id);
  return {
    id: `storyboard:${s.id}`,
    title: s.title,
    url: s.url,
    metadata: { type: "storyboard", status: s.status },
    text: lines(
      `# ${s.title}`,
      `Status: ${s.status}${s.deliverable ? ` · ${s.deliverable.project.name} / ${s.deliverable.name}` : ""}`,
      s.description ? `\n${s.description}` : null,
      ...s.screens.map((sc) => {
        const f = sc as unknown as Record<string, string>;
        return lines(
          "",
          `## ${sc.number}. ${sc.title} (${sc.type.replace("_", " ")})`,
          ...FIELD_TITLES.filter(([k]) => f[k]).map(([k, label]) => `\n**${label}**\n${f[k]}`),
        );
      }),
    ),
  };
}

async function reviewDoc(id: string): Promise<Doc> {
  const r = await loadRound(id, true);
  return {
    id: `review:${r.id}`,
    title: `${r.deliverable.name} · review round ${r.round}`,
    url: r.url,
    metadata: { type: "review", outcome: r.outcome },
    text: lines(
      `# ${r.deliverable.name} — review round ${r.round}`,
      `Project: ${r.project.name} · Outcome: ${r.outcome.replace("_", " ")}${r.due ? ` · Due ${r.due}` : ""}`,
      "",
      "## Reviewers",
      bullet(r.reviewers.map((x) => `${x.name}${x.guest ? " (guest)" : ""}: ${x.decision}${x.summary ? ` — "${x.summary}"` : ""}`)),
      "",
      "## Comments",
      r.comments.length
        ? r.comments
            .map((c) =>
              lines(
                `### ${c.where} — ${c.author} [${c.status}]`,
                c.quote ? `> ${c.quote}` : null,
                c.body,
                ...c.replies.map((x) => `↳ **${x.author}**: ${x.body}`),
                c.resolution ? `_${c.resolution}_` : null,
              ),
            )
            .join("\n\n")
        : "_none_",
    ),
  };
}

async function deliverableDoc(id: string): Promise<Doc> {
  if (!(await getDeliverableForUser(id))) throw new ToolError("Deliverable not found, or you can't see it.");
  const d = await prisma.deliverable.findUniqueOrThrow({
    where: { id },
    select: {
      name: true,
      type: true,
      status: true,
      project: { select: { id: true, name: true } },
      storyboard: { select: { id: true, title: true } },
      reviewRounds: { orderBy: { number: "desc" }, select: { id: true } },
    },
  });
  const rounds = await Promise.all(d.reviewRounds.map((r) => reviewDoc(r.id)));
  return {
    id: `deliverable:${id}`,
    title: `${d.name} (${d.project.name})`,
    url: link(`/projects/${d.project.id}`),
    metadata: { type: "deliverable", status: d.status },
    text: lines(
      `# ${d.name}`,
      `${d.type} deliverable in ${d.project.name} · ${d.status.replace("_", " ")}`,
      d.storyboard ? `Storyboard: ${d.storyboard.title} (storyboard:${d.storyboard.id})` : null,
      ...rounds.map((r) => `\n${r.text.replace(/^# /, "## ")}`),
    ),
  };
}

async function intakeDoc(id: string): Promise<Doc> {
  const r = await loadIntake(id);
  return {
    id: `intake:${r.id}`,
    title: `${r.ticket} · ${r.title}`,
    url: r.url,
    metadata: { type: "intake", status: r.status },
    text: lines(
      `# ${r.ticket}: ${r.title}`,
      `Status: ${r.status} · From ${r.requester.name}${"email" in r.requester ? ` <${r.requester.email}>` : ""} · Submitted ${r.submitted}`,
      `Audience: ${r.targetAudience ?? "—"} · Target date: ${r.targetDate ?? "—"}`,
      `Impact ${r.impact ?? "?"} / Effort ${r.effort ?? "?"}${r.quadrant ? ` (${r.quadrant})` : ""}`,

      r.decided ? `Decided ${r.decided.on}${r.decided.by ? ` by ${r.decided.by}` : ""}${r.rejectionReason ? `: ${r.rejectionReason}` : ""}` : "",
      "",
      r.description,
      ...(r.conversation.length
        ? ["", "## Conversation", ...r.conversation.map((m) => `- ${m.from}${m.kind === "note" ? " (internal note)" : ""}, ${m.at.slice(0, 10)}: ${m.body}`)]
        : []),
    ),
  };
}

async function whiteboardDoc(id: string): Promise<Doc> {
  const w = await loadWhiteboard(id);
  const texts = w.items.filter((i) => i.text && i.kind !== "arrow" && i.kind !== "line");
  return {
    id: `whiteboard:${w.id}`,
    title: `Whiteboard · ${w.title}`,
    url: w.url,
    metadata: { type: "whiteboard" },
    text: lines(
      `# ${w.title}`,
      "",
      w.card ? `Card: ${w.card.key ?? w.card.title} (card:${w.card.id})` : null,
      w.storyboard ? `Storyboard: ${w.storyboard.title} (storyboard:${w.storyboard.id})` : null,
      "",
      "## On the whiteboard",
      bullet(texts.map((i) => `${i.kind}${i.frame ? ` in ${w.items.find((f) => f.id === i.frame)?.text ?? "a frame"}` : ""}: ${i.text}`)),
      "",
      "## Connections",
      bullet(w.connections),
      w.freehandDrawings ? `\n_${w.freehandDrawings} freehand drawing(s) not described._` : null,
    ),
  };
}

async function contentDoc(id: string): Promise<Doc> {
  const c = await loadContent(id);
  return {
    id: `content:${c.id}`,
    title: `Content · ${c.title}`,
    url: c.url,
    metadata: { type: "content", lifecycle: c.lifecycle, status: c.status },
    text: lines(
      `# ${c.title}`,
      "",
      `${c.type} · ${c.status} · ${c.lifecycle}${c.why ? ` (${c.why})` : ""}`,
      `Owner: ${c.owner ? c.owner.name ?? c.owner.email : "—"}`,
      `Published: ${c.publishedAt ?? "—"} · Next review: ${c.reviewDate ?? "—"}${c.reviewEveryMonths ? ` (every ${c.reviewEveryMonths} months)` : ""} · Expires: ${c.expiryDate ?? "—"}`,
      c.externalUrl ? `Lives at: ${c.externalUrl}` : null,
      c.labels.length ? `Labels: ${c.labels.join(", ")}` : null,
      c.project ? `From project: ${c.project.name} (project:${c.project.id})` : null,
      c.description ? `\n${c.description}` : null,
    ),
  };
}

const FETCHERS: Record<string, (id: string) => Promise<Doc>> = {
  card: cardDoc,
  project: projectDoc,
  board: boardDoc,
  storyboard: storyboardDoc,
  review: reviewDoc,
  deliverable: deliverableDoc,
  intake: intakeDoc,
  whiteboard: whiteboardDoc,
  content: contentDoc,
};

export function registerDocumentTools(server: McpServer) {
  tool(
    server,
    "search",
    {
      title: "Search the workspace",
      description:
        "Search cards (by title, or a key such as SEC-12), projects, deliverables, boards, storyboards, whiteboards, review rounds, intake requests and tracked content by name. Returns ids to pass to fetch, which returns the full document.",
      input: { query: z.string().min(1).describe("Words to look for, or a card key such as SEC-12") },
      output: { results: z.array(z.object({ id: z.string(), title: z.string(), url: z.string() })) },
      kind: "read",
    },
    async ({ query }) => {
      const wsId = principal().workspaceId;
      const q = query.trim();
      const contains = { contains: q, mode: "insensitive" as const };
      const [boardVis, projectVis, storyboardVis, whiteboardVis] = await Promise.all([boardVisibilityWhere(), projectVisibilityWhere(), storyboardVisibilityWhere(), whiteboardVisibilityWhere()]);
      const onBoard = { board: { workspaceId: wsId, ...boardVis } };
      const key = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d+)$/.exec(q);
      const [keyHit, cards, projects, deliverables, boards, storyboards, rounds, intake, whiteboards, content] = await Promise.all([
        key ? resolveCardKey(key[1], Number(key[2])) : null,
        prisma.card.findMany({
          where: { title: contains, OR: [{ column: onBoard }, { parentCard: { column: onBoard } }] },
          orderBy: { updatedAt: "desc" },
          take: 10,
          select: { id: true, title: true, keySeq: true, column: { select: { board: { select: { id: true, cardKeyPrefix: true } } } }, parentCard: { select: { id: true, column: { select: { boardId: true } } } } },
        }),
        prisma.project.findMany({ where: { workspaceId: wsId, name: contains, ...projectVis }, take: 5, select: { id: true, name: true } }),
        prisma.deliverable.findMany({ where: { name: contains, project: { workspaceId: wsId, ...projectVis } }, take: 5, select: { id: true, name: true, project: { select: { id: true, name: true } } } }),
        prisma.board.findMany({ where: { workspaceId: wsId, name: contains, ...boardVis }, take: 5, select: { id: true, name: true } }),
        prisma.storyboard.findMany({ where: { workspaceId: wsId, title: contains, ...storyboardVis }, take: 5, select: { id: true, title: true } }),
        prisma.reviewRound.findMany({
          where: { deliverable: { name: contains, project: { workspaceId: wsId, ...projectVis } } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, number: true, deliverable: { select: { name: true } } },
        }),
        prisma.intakeRequest.findMany({ where: { workspaceId: wsId, title: contains }, take: 5, select: { id: true, number: true, title: true } }),
        prisma.whiteboard.findMany({ where: { workspaceId: wsId, title: contains, ...whiteboardVis }, take: 5, select: { id: true, title: true } }),
        prisma.contentItem.findMany({ where: { workspaceId: wsId, title: contains }, take: 5, select: { id: true, title: true } }),
      ]);
      const results: { id: string; title: string; url: string }[] = [];
      if (keyHit) results.push({ id: `card:${keyHit.cardId}`, title: `${q.toUpperCase()} · ${keyHit.title}`, url: link(`/boards/${keyHit.boardId}?card=${keyHit.cardId}`) });
      for (const c of cards) {
        if (c.id === keyHit?.cardId) continue;
        const board = c.column?.board;
        const k = board?.cardKeyPrefix && c.keySeq ? `${board.cardKeyPrefix}-${c.keySeq} · ` : "";
        const boardId = board?.id ?? c.parentCard?.column?.boardId ?? "";
        results.push({ id: `card:${c.id}`, title: `Card ${k}${c.title}`, url: link(`/boards/${boardId}?card=${c.parentCard?.id ?? c.id}`) });
      }
      for (const p of projects) results.push({ id: `project:${p.id}`, title: `Project · ${p.name}`, url: link(`/projects/${p.id}`) });
      for (const d of deliverables) results.push({ id: `deliverable:${d.id}`, title: `Deliverable · ${d.name} (${d.project.name})`, url: link(`/projects/${d.project.id}`) });
      for (const b of boards) results.push({ id: `board:${b.id}`, title: `Board · ${b.name}`, url: link(`/boards/${b.id}`) });
      for (const s of storyboards) results.push({ id: `storyboard:${s.id}`, title: `Storyboard · ${s.title}`, url: link(`/storyboards/${s.id}`) });
      for (const r of rounds) results.push({ id: `review:${r.id}`, title: `Review · ${r.deliverable.name}, round ${r.number}`, url: link(`/reviews/${r.id}`) });
      for (const r of intake) results.push({ id: `intake:${r.id}`, title: `Intake ${ticketLabel(r.number)} · ${r.title}`, url: link("/intake") });
      for (const w of whiteboards) results.push({ id: `whiteboard:${w.id}`, title: `Whiteboard · ${w.title}`, url: link(`/whiteboards/${w.id}`) });
      for (const c of content) results.push({ id: `content:${c.id}`, title: `Content · ${c.title}`, url: link(`/content/${c.id}`) });
      return { results };
    },
  );

  tool(
    server,
    "fetch",
    {
      title: "Fetch a document",
      description:
        "The full text of one item from search, as Markdown: a card, project, deliverable (with all its review rounds), board, storyboard (every screen), whiteboard (its text and connections), review round (every comment) or intake request. Pass the id from search, e.g. card:abc123; a card key such as SEC-12 also works.",
      input: { id: z.string().min(1).describe("An id from search, like card:… or project:…") },
      output: {
        id: z.string(),
        title: z.string(),
        text: z.string(),
        url: z.string(),
        metadata: z.record(z.string(), z.string()),
      },
      kind: "read",
    },
    async ({ id }) => {
      const m = /^([a-z]+):(.+)$/.exec(id.trim());
      if (!m) return cardDoc(await resolveCardId(id));
      const f = FETCHERS[m[1]];
      if (!f) throw new ToolError(`Unknown id type "${m[1]}". Use an id from search.`);
      return f(m[2]);
    },
  );
}
