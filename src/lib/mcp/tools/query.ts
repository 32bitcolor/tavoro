import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { runQuery } from "@/lib/query/run";
import { bulkUpdateCards, type BulkChange } from "@/app/actions/card-query";
import { link, principal, resolveCardId, tool, ToolError } from "@/lib/mcp/util";
import { resolveMember, resolveSprint } from "@/lib/mcp/tools/cards";
import { cardHref } from "@/lib/mcp/tools/workspace";

// The card query language over MCP (docs/JIRA-PARITY.md, phase 7).

const QUERY_HELP =
  'Query language (like Jira\'s JQL): field op value, joined with AND / OR / NOT and brackets, then optional ORDER BY field [DESC]. Fields: text (~), title, key, type, status, category (todo/active/done), priority (> means more urgent), estimate, assignee / sme / watcher (me, a name or an email), labels, epic (key or title), sprint (name, active, planned, completed), board (name or key prefix), project, due / start / created / updated (2026-12-01, today, 7d, -2w), blocked, done (true/false). Operators: = != > >= < <= ~ (contains) in (a, b) not in (…) is EMPTY / is not EMPTY. Quote values with spaces. Sort by rank, key, title, created, updated, due, start, priority, estimate, status or type. Example: status = "In progress" AND assignee = me AND due < 7d ORDER BY priority DESC.';

export function registerQueryTools(server: McpServer) {
  tool(
    server,
    "search_cards",
    {
      title: "Search cards with a query",
      description: `Find cards across every board you can see. ${QUERY_HELP} Returns the matching cards (up to \`limit\`) and the total.`,
      input: { query: z.string().max(2000).default(""), limit: z.number().int().min(1).max(200).default(50) },
      kind: "read",
    },
    async ({ query, limit }) => {
      const p = principal();
      const r = await runQuery(p.workspaceId, p.userId, query, 0, limit);
      if (!r.ok) throw new ToolError(`${r.error} (at character ${r.pos + 1} of the query)`);
      return {
        total: r.total,
        truncated: r.truncated || undefined,
        url: link(`/cards?q=${encodeURIComponent(query)}`),
        cards: r.rows.map((c) => ({
          key: c.key ?? undefined,
          id: c.id,
          title: c.title,
          type: c.type,
          status: c.status?.name,
          priority: c.priority ?? undefined,
          estimate: c.estimate ?? undefined,
          assignees: c.assignees.map((a) => a.name ?? a.email),
          labels: c.labels.map((l) => l.name),
          sprint: c.sprint?.name,
          epic: c.epic ? (c.epic.key ?? c.epic.title) : undefined,
          board: c.board.name,
          due: c.due ?? undefined,
          url: cardHref(c.board.id, c.id),
        })),
      };
    },
  );

  tool(
    server,
    "bulk_update_cards",
    {
      title: "Change many cards at once",
      description: `Apply the same changes to many cards — named in \`cards\` (keys or ids), or every card matching \`query\` (see search_cards). Up to 200 cards. Each card is changed through the same rules as update_card and its History records it; people get one email for the batch. Cards you can't change are listed, not changed. Deleting isn't offered in bulk.`,
      input: {
        cards: z.array(z.string()).max(200).optional(),
        query: z.string().max(2000).optional(),
        status: z.string().optional().describe("A status name"),
        priority: z.string().optional().describe("highest, high, medium, low, lowest, or none"),
        type: z.enum(["task", "story", "bug", "epic"]).optional(),
        estimate: z.number().min(0).nullable().optional(),
        sprint: z.string().optional().describe("Sprint name, id or 'active'; empty takes cards out of their sprint"),
        epic: z.string().optional().describe("Epic key or title; empty takes cards out of their epic"),
        add_assignees: z.array(z.string()).max(10).optional(),
        remove_assignees: z.array(z.string()).max(10).optional(),
        add_labels: z.array(z.string()).max(10).optional(),
        remove_labels: z.array(z.string()).max(10).optional(),
      },
      kind: "write",
    },
    async (a) => {
      const p = principal();
      let ids: string[];
      if (a.cards?.length) ids = await Promise.all(a.cards.map((c) => resolveCardId(c)));
      else if (a.query !== undefined) {
        // An empty query matches everything: never a safe thing to bulk-change by accident.
        if (!a.query.replace(/\border\s+by\b[\s\S]*$/i, "").trim()) throw new ToolError("Give a query that narrows the cards (an empty query matches every card), or name them in `cards`.");
        const r = await runQuery(p.workspaceId, p.userId, a.query, 0, 1);
        if (!r.ok) throw new ToolError(`${r.error} (at character ${r.pos + 1} of the query)`);
        if (r.total > 200) throw new ToolError(`That query matches ${r.total} cards; narrow it to 200 or fewer.`);
        ids = r.ids;
      } else throw new ToolError("Name the cards (cards) or give a query.");
      if (!ids.length) return { updated: 0, note: "No cards matched." };

      const changes: { change: BulkChange; label: string }[] = [];
      if (a.status) {
        const s = await prisma.workspaceStatus.findFirst({ where: { workspaceId: p.workspaceId, name: { equals: a.status.trim(), mode: "insensitive" } }, select: { id: true, name: true } });
        if (!s) throw new ToolError(`No status "${a.status}".`);
        changes.push({ change: { kind: "status", statusId: s.id }, label: `status ${s.name}` });
      }
      if (a.priority) changes.push({ change: { kind: "priority", priority: a.priority === "none" ? null : a.priority }, label: `priority ${a.priority}` });
      if (a.type) changes.push({ change: { kind: "type", type: a.type }, label: `type ${a.type}` });
      if (a.estimate !== undefined) changes.push({ change: { kind: "estimate", estimate: a.estimate }, label: `estimate ${a.estimate ?? "cleared"}` });
      if (a.sprint !== undefined) changes.push({ change: { kind: "sprint", sprintId: a.sprint.trim() ? (await resolveSprint(a.sprint)).id : null }, label: `sprint ${a.sprint || "cleared"}` });
      if (a.epic !== undefined) {
        let epicId: string | null = null;
        if (a.epic.trim()) {
          const ref = a.epic.trim();
          const byKey = /^[A-Za-z][A-Za-z0-9]{0,9}-\d+$/.test(ref) ? await resolveCardId(ref).catch(() => null) : null;
          const e = byKey
            ? { id: byKey }
            : await prisma.card.findFirst({ where: { type: "epic", title: { equals: ref, mode: "insensitive" }, column: { board: { workspaceId: p.workspaceId } } }, select: { id: true } });
          if (!e) throw new ToolError(`No epic "${a.epic}".`);
          epicId = e.id;
        }
        changes.push({ change: { kind: "epic", epicId }, label: `epic ${a.epic || "cleared"}` });
      }
      for (const r of a.add_assignees ?? []) changes.push({ change: { kind: "assignee", userId: (await resolveMember(r)).id, add: true }, label: `assign ${r}` });
      for (const r of a.remove_assignees ?? []) changes.push({ change: { kind: "assignee", userId: (await resolveMember(r)).id, add: false }, label: `unassign ${r}` });
      const label = async (ref: string) => {
        const l = await prisma.label.findFirst({ where: { workspaceId: p.workspaceId, name: { equals: ref.trim(), mode: "insensitive" } }, select: { id: true } });
        if (!l) throw new ToolError(`No label "${ref}".`);
        return l.id;
      };
      for (const r of a.add_labels ?? []) changes.push({ change: { kind: "label", labelId: await label(r), add: true }, label: `add label ${r}` });
      for (const r of a.remove_labels ?? []) changes.push({ change: { kind: "label", labelId: await label(r), add: false }, label: `remove label ${r}` });
      if (!changes.length) throw new ToolError("Say what to change: status, priority, type, estimate, sprint, epic, assignees or labels.");

      const out: { change: string; updated: number; failed: { card: string; error: string }[] }[] = [];
      for (const c of changes) {
        const r = await bulkUpdateCards(ids, c.change);
        if ("error" in r && r.error) throw new ToolError(r.error);
        const ok = r as { updated: number; failed: { card: string; error: string }[] };
        out.push({ change: c.label, updated: ok.updated, failed: ok.failed });
      }
      return { cards: ids.length, changes: out };
    },
  );
}
