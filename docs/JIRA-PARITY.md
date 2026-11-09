# Jira parity: boards that can replace Jira for an ID team

**Status:** Phases 1–4 shipped to prod (phase 4 on 2026-11-09); phase 5 (Jira import) built and tested against the mock.
**Owner:** @32bitcolor

## Why

Tavoro's boards cover the basics: keyed cards (`SEC-7`), canonical statuses, one level of
subtasks, labels, assignees and SMEs, due dates, team sprints, saved filters, comments with
@-mentions, attachments, moving cards between boards, private cards, public links and group
access. Teams coming from Jira still miss the structure Jira gives them: issue types and
epics, priority and estimates, links between issues, an activity history, and a backlog to
plan sprints from. And they have years of work in Jira they want to bring with them.

The aim is the part of Jira an ID team uses day to day, not all of Jira. **Out of scope:**
per-project workflow editors and transition rules, permission schemes, the marketplace,
and service-desk features (intake already covers requests).

## Tiers

| Tier | What | Notes |
|---|---|---|
| **1. Core** | Issue types + epics, priority, estimates, card links, watchers + activity history, Backlog view, **Jira import** | This doc. |
| 2. Power | List/table view with bulk edit, a query language (saved as filters), swimlanes + WIP limits, custom card fields | Own doc later. |
| 3. Insight | Burndown, velocity, sprint report; epic timeline | Extends Reports. |
| 4. Automation | "When X, do Y" rules on the BullMQ worker | Later. |

Tier 1 is designed so the Jira import has somewhere to put everything it reads. An
import that drops issue types, epics, priorities, points or links would lose work, so those
land first and the importer last.

## Tier 1 data model

### Issue types

`Card.type String @default("task")` — one of `task`, `bug`, `story`, `epic`. Subtasks stay
what they are (a card with `parentCardId`), shown as type "Subtask" and not settable.

A fixed set, not a per-workspace editor: four types cover Jira's defaults, keep filters and
icons simple, and an imported custom type maps to the nearest (anything unknown → `task`,
with the Jira type name kept in the import record).

### Epics

An epic **is a card** with `type = "epic"`, like Jira. It lives on a board, has a key, a
status, a description and comments. Other cards point at it:

`Card.epicId String?` → `Card` (`onDelete: SetNull`).

- An epic can collect cards from **any board in the workspace** (Jira's company-managed
  model), so an epic like "Q1 onboarding refresh" spans the course board and the video board.
- Rules: an epic can't be in an epic; a subtask can't have its own epic (it follows its
  parent); an epic has no sprint (Jira's rule — sprints hold the work, epics outlive them).
- The epic's card shows its child cards with a done / total bar, computed from their
  statuses' `done` category. There's no separate epic status field.
- Visibility: children the viewer can't see (restricted board) are counted but not listed.

### Priority

`Card.priority String?` — `highest`, `high`, `medium`, `low`, `lowest`, or null (none).
Jira's five, so an import maps one to one. Shown as an icon on the card face, and sortable.

### Estimates

`Card.estimate Float?` plus `Workspace.estimateUnit String @default("points")` (`points` or
`hours`). One number per card, the unit chosen per workspace in Settings. Story points are
what Jira teams plan sprints with; ID teams that estimate in hours can switch. Sprint pages
total it (planned vs. done). Time already logged against projects (`TimeEntry`) is separate
and stays so.

### Card links

```prisma
model CardLink {
  id        String   @id @default(cuid())
  fromId    String   // the card the link reads from: "<from> blocks <to>"
  toId      String
  type      String   // blocks / relates / duplicates / clones
  createdById String?
  createdAt DateTime @default(now())
  @@unique([fromId, toId, type])
  @@index([toId])
}
```

One row per link, shown from both sides with the inverse wording ("blocks" / "is blocked by",
"duplicates" / "is duplicated by", "clones" / "is cloned by", "relates to" both ways).
Links can cross boards. A card that is blocked by an unfinished card shows a "Blocked" mark
on its face. Self-links are refused; `relates` is stored once (the lower id first) so it
can't appear twice.

### Watchers and activity

```prisma
model CardWatcher { cardId String; userId String; @@id([cardId, userId]) }

model CardActivity {
  id        String   @id @default(cuid())
  cardId    String
  actorId   String?  // null = system (import, automation)
  kind      String   // created / status / assignee / priority / estimate / sprint / epic / type / due / link / title / moved
  data      Json     // { from, to } in display form, so history reads correctly after renames
  createdAt DateTime @default(now())
  @@index([cardId, createdAt])
}
```

- Creating, commenting on, or being assigned a card makes you a watcher; you can unwatch.
- Watchers get a notification (the existing in-app notifications, and email by their
  preference) when the status, assignee or priority changes, or when someone comments.
- The card drawer gets a **History** tab next to Comments. Description edits are recorded
  as "edited the description" without a diff (TipTap JSON diffs aren't readable).
- Activity is written in the same transaction as the change, from the server actions and
  MCP tools alike, through one `recordActivity()` helper.

### Backlog view

A **Backlog** page under Sprints: every active or planned sprint as a section, then
**Backlog** (cards with no sprint, not done). Drag cards between sections to plan; each
section shows its card count and estimate total. "Start sprint" and "Complete sprint" live
here too; completing moves unfinished cards to the next sprint or the backlog (asked).
Filterable by project, board, epic, assignee and label, like the sprint board.

Ordering: the backlog needs a rank that spans boards, so `Card.rank String?` (fractional
index, like positions) is used here and nowhere else. Cards without a rank sort after ranked
ones, by creation date.

As built (phase 4): `/sprints/backlog`. `Card.rank` is `COLLATE "C"` so keys sort byte-wise
whatever the server locale. The first time someone ranks next to an unranked card, every
unranked card in the workspace gets a rank after the last ranked one, oldest first (the order
they already show in), so nothing visibly moves. The backlog section shows the first 1,500
cards. Starting a sprint records what it holds (`Sprint.report.committed`); completing it
records done / not done counts and points, where the unfinished cards went, and how many done
cards were added after the start (`Sprint.report.completed`), for Tier 3 reports. A completed
sprint is closed to new cards; `update_sprint` status changes go through start/complete.
Sprints still aren't part of a workspace backup (ranks are).

## Jira import

### Source

**Jira Cloud REST API** (v3, plus the Agile API for sprints and boards), authenticated with
the admin's Atlassian email and an **API token** (made at id.atlassian.com → Security). The
token is used for the run and **never stored**; the run keeps only the site URL.

CSV export was considered and rejected: it flattens rich text, drops attachments and
comment authors, and its columns change with each Jira configuration. Jira Data Center
(personal access tokens, API v2) can be added later behind the same mapper.

### Flow

1. **Settings → Import → Jira** (admins). Enter the site (`acme.atlassian.net`), email and
   token. Tavoro checks access and lists the Jira projects the token can see.
2. Pick projects. For each, choose the target: a **new board** (default; named after the
   project, key prefix = the Jira project key) or an existing board.
3. **Map** (prefilled, editable):
   - Jira statuses → workspace statuses, matched by name; unmatched ones are created in the
     right category (Jira's status category: To Do / In Progress / Done).
   - Jira users → members, matched by email. Unmatched people are listed; their work still
     comes over (see "People").
   - Issue types → Tavoro types (Story, Bug, Task, Epic; Sub-task → subtask; others → Task).
   - The story-points field is found automatically (Jira's `Story point estimate` /
     `Story Points`); the admin can pick a different number field.
4. **Dry run** summary: counts of issues, comments, attachments (and total size), sprints,
   links, plus everything that won't come over. Then **Import**.
5. The run happens on the **worker** (BullMQ job), with a progress page; it survives the
   admin closing the tab. A finished run shows a report: what came over, what was skipped
   and why, with links.

### What comes over

| Jira | Tavoro |
|---|---|
| Project | Board (columns from the project's Jira board configuration, if there is one; otherwise one per status used, in category order) |
| Issue key `PROJ-123` | Same key. The board's prefix is `PROJ` and `keySeq` = 123, so links and mentions people remember keep working. If the prefix is taken in Tavoro, the admin chooses a new one and the old keys are kept as aliases (`CardKeyAlias`). |
| Summary, description | Title; description converted from Atlassian Document Format to TipTap JSON (both are ProseMirror-based: paragraphs, headings, lists, code, quotes, links, marks, tables map directly; panels → quotes; media → attachments, inline where possible; unknown nodes → their text) |
| Type, priority, status, labels, due date, created date | Same fields; labels created workspace-wide if missing |
| Assignee, reporter | Assignee (if matched); reporter becomes the card's first watcher |
| Story points | `estimate` |
| Epic (parent of a standard issue) / epic link | `epicId` |
| Sub-tasks | Subtasks |
| Sprints | Sprints (name, goal, dates, state); a card in several sprints goes to the latest |
| Issue links | `CardLink` (Blocks, Relates, Duplicate, Cloners; other link types → `relates`, named in the report) |
| Comments | Comments, with original author and date; ADF converted to text with @-mentions of matched members |
| Attachments | Attachments (downloaded and stored; same 95 MB per-file limit as uploads) |
| Watchers | Watchers (matched members) |
| Components, fix versions | Labels (`component: X`, `version: Y`); can be switched off in the mapping step |
| Change history | Not imported. One activity entry: "Imported from PROJ-123 on Jira" with a link. |

**Not imported** (listed in the dry run): custom fields other than story points, worklogs,
Jira automation and workflows,
votes, and permission settings.

### People

A comment needs an author. For a Jira user with no matching member, the comment is authored
by the admin running the import and starts with *"Originally by Jane Doe, 3 Mar 2025"* — and
`Comment.importedAuthor String?` holds the name so the UI shows "Jane Doe (from Jira)"
instead of the admin. Unmatched assignees leave the card unassigned and are named in a
short "From Jira" footer on the card. Nobody is invited or emailed by an import, and
watchers aren't notified of imported changes.

### Re-running

`Card.externalRef String?` (`jira:<cloudId>:<issueId>`, unique per workspace) and a
`JiraImport` run record (site, projects, mappings, counts, report, who, when). Running the
same project again **updates** cards it imported before (fields, new comments, new
attachments) and adds new ones. It never deletes, and it doesn't overwrite a field someone
changed in Tavoro since the last run (compared to the value the last run wrote). That lets a
team import, keep working in Jira for a week, and top up before switching.

### Limits and safety

- Jira's rate limits: requests are paced and retried with backoff on 429, honouring
  `Retry-After`.
- Large projects: issues are fetched by JQL in pages of 100 and written in batches; a run can
  resume from the last page after a worker restart.
- The site must be `*.atlassian.net` (or an admin-approved host) and is fetched server side
  with redirects refused, so the importer can't be pointed at internal addresses.
- A backup is suggested before the first import (Settings → Backups).

### As built (phase 5)

- **Code:** `src/lib/jira/` — `client.ts` (REST client: site allow-list, refused
  redirects, 429 backoff, paging by `nextPageToken` on `/rest/api/3/search/jql`),
  `adf.ts` (ADF → TipTap, unit-tested), `map.ts` (mapping rules, unit-tested), `engine.ts`
  (scan + import, run on the worker's `jira-import` queue). UI and actions:
  `Settings → Import`, `app/actions/jira-import.ts`.
- **Token:** the doc said "never stored"; the worker needs it for the length of the run,
  so it's sealed onto the `JiraImport` row (AES-256-GCM, key derived from
  `SESSION_SECRET`, `lib/secret-box.ts`) and wiped when the run finishes, fails or is
  cancelled. A re-run asks for the token again.
- **Re-runs:** `ImportedCard` (cardId, `jira:<cloudId>:<issueId>`, Jira key, snapshot of
  what the last run wrote per field + Jira→Tavoro comment and attachment ids) instead of
  a `Card.externalRef` column. `Board.externalRef` / `Sprint.externalRef` find the board
  and sprints again. Comments already imported aren't updated if edited in Jira. A card
  deleted in Tavoro is imported again on the next run.
- **Keys:** when a card can't keep its Jira key (existing board with another prefix, or
  the number is taken), it gets the board's next key and the old key still resolves
  through `ImportedCard.externalKey` (search, MCP, links) — `CardKeyAlias` needs the
  prefix's own board, which there isn't.
- **Unmatched comment authors:** `Comment.importedAuthor` holds the name and the UI shows
  "Jane Doe (from Jira)"; no "Originally by" line is added to the body.
- **People:** matched by email, then by display name when Jira hides emails and exactly
  one member has that name.
- **Columns:** from the Jira board's column layout; a Jira column with several statuses
  becomes one Tavoro column per status, side by side.
- **Order:** Jira's rank field orders the imported cards in the Backlog.
- **Mock:** `scripts/jira-mock/server.mjs` (run it, set
  `JIRA_ALLOWED_HOSTS=localhost:4010,127.0.0.1:4011`, connect to
  `http://localhost:4010` as `admin@acme.test` / `mock-token`).

### MCP and backups

New fields (type, epic, priority, estimate, links, watchers) go into the MCP card tools and
the workspace backup (format bump). The import itself is admin-only and not exposed to MCP.

## Phases

| Phase | Scope | Size |
|---|---|---|
| **1** | Issue types, priority, estimates (+ Settings unit), card face icons, filters and sort by them | Small |
| **2** | Epics (epic card view, child list, "Add to epic", epic filter on boards and sprint board) | Medium |
| **3** | Card links + Blocked mark; watchers + notifications; History tab and `recordActivity` | Medium |
| **4** | Backlog view with cross-board rank, sprint start/complete | Medium |
| **5** | Jira import (API client, ADF → TipTap, mapping UI, worker job, report, re-run) | Large |

Each phase ships to test, is checked end to end, and waits for approval before prod.

## Decisions (2026-11-08)

1. **Jira Cloud** (`*.atlassian.net`). Data Center later if needed.
2. **Story points** are the default estimate unit.
3. **Components and fix versions come over as labels** (`component: Onboarding`,
   `version: 2.1`), on by default.
4. **No real Jira data to test against.** The importer is tested against a local mock of
   the Jira Cloud API serving fixtures in Jira's documented response shapes (rich ADF,
   epics, subtasks, sprints, links, attachments, unmatched users, 429s, pagination).
   A real site can be checked later with a free Atlassian Cloud account.
