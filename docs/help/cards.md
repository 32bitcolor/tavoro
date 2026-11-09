<!-- Generated from src/components/help by `npm run help:export`. Edit the app's help, not this file. -->

# Cards: search and bulk edit

> **Cards** in the sidebar lists every card you can see, across every board, found with a short query. Sort the results, choose the columns, save the query for later, and change many cards at once.

## Write a query

A query is one or more conditions — a field, an operator and a value — joined with `AND`, `OR` and `NOT`, with brackets where you need them. Add `ORDER BY` to sort. As you type, the bar suggests fields, operators and values from your workspace; press **Tab** or **Enter** to take one, and **Enter** to search.

- `assignee = me AND done = false` — your open cards
- `status = "In review" AND updated < -7d` — stuck in review for a week
- `labels in (qa, video) AND priority >= high ORDER BY due`
- `sprint = active AND blocked = true` — what’s holding the sprint up
- `epic is EMPTY AND type = story` — stories that belong to no epic

If something’s wrong, the bar highlights the part it couldn’t read and says why — an unknown status, say, with the ones that exist.

### Fields

- `text ~` searches titles and descriptions; `title`, `key` (`SEC-12`, and old or Jira keys too)
- `type`, `status`, `category` (todo, active, done), `priority` (where `>` means more urgent), `estimate`
- `assignee`, `sme` and `watcher` take `me`, a name or an email
- `labels`, `epic` (key or title), `sprint` (a name, or active, planned, completed), `board` (name or key prefix), `project`
- `due`, `start`, `created`, `updated` take a date (`2026-12-01`), `today`, or a distance from today: `7d`, `-2w`, `1m`
- `blocked` and `done` are true or false

Operators: `=` `!=` `>` `>=` `<` `<=`, `~` (contains), `in (a, b)`, `not in (…)`, and `is EMPTY` / `is not EMPTY`. Put values with spaces in quotes. As in Jira, `!=` leaves out cards with no value at all — add `OR field is EMPTY` to include them.

## The results

Click a column header to sort by it (it rewrites the query’s `ORDER BY`), choose what to show with **Columns**, and click a card to open it in the card panel. Keep a query — with its columns — under **Views** → **Save current filters…**; saved queries are personal. The page’s address includes the query, so you can share a link.

## Change many cards at once

Tick cards (or all on the page, then **Select all matching**, up to 1,000), then choose a change in the bar at the bottom: status, assign or unassign someone, priority, type, estimate, sprint, epic, add or remove a label, watch, move to another board, or delete. You confirm once.

> **What a bulk change does.** Each card changes exactly as if you’d changed it on its own: the same permissions, a line in its History, and notifications — but everyone affected gets **one email** listing the cards, not one per card. Cards you can’t change are listed with the reason.

---

← [Boards (Kanban)](boards.md) · [All guides](README.md) · [Projects](projects.md) →
