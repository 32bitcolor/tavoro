<!-- Generated from src/components/help by `npm run help:export`. Edit the app's help, not this file. -->

# Import from Jira

> Moving from Jira? Admins can bring Jira Cloud projects into Tavoro as boards — issues with their keys, types, priorities, story points, epics, sub-tasks, sprints, links, comments, attachments and watchers. You see what will come over before anything is imported, and you can run it again later to pick up what changed in Jira.

## Before you start

- You need to be a workspace **admin** in Tavoro, and have an Atlassian account that can browse the projects you want.
- Make an **API token** at **id.atlassian.com → Security → API tokens**. Tavoro keeps it encrypted only while the import runs and deletes it when the import ends.
- Invite your team first. People are matched to members by email (or by name when Jira hides the email), so the more of them are here, the more assignees, comments and watchers line up.
- Take a **Backup** (Settings) first if you’re importing into a workspace that already has work in it.

## Run an import

1. Go to **Settings → Import**. Enter your Jira site (*acme.atlassian.net*), the Atlassian account’s email and the API token, and click **Connect**.
2. Tick the projects to import. Each becomes **A new board** named after the project, with the Jira project key as its key prefix — so *PROJ-123* stays *PROJ-123*. You can rename it, change the prefix, or pick an existing board instead.
3. Click **Scan**. Tavoro reads the projects (nothing is imported yet) and shows what will come over: issues, sub-tasks, epics, comments, attachments, sprints, links and labels, with anything that won’t.
4. Check the **mapping**. Jira statuses are matched to your statuses by name; ones with no match are created in the right category. People are matched to members; anyone unmatched keeps their name on their comments. Issue types become Task, Story, Bug or Epic, and sub-tasks become subtasks. The story points field is found for you.
5. Click **Import**. It runs in the background — you can leave the page — and finishes with a report and links to the new boards.

## What comes over

**Issues** — Cards with the same key, title, description (rich text converted), type, priority, status, due date, labels and created date. Story points become the card’s estimate.

**Epics and sub-tasks** — Epics become epic cards with their issues in them; sub-tasks become subtasks of their card.

**Sprints** — Sprints come over with their name, goal, dates and state (future → planned, active, closed → completed). A card that was in several sprints goes in the latest. The Backlog keeps Jira’s rank order.

**Links** — *Blocks*, *relates to*, *duplicates* and *clones* come over as the same links; other link types become *relates to*.

**Comments and attachments** — Comments keep their author and date. Attachments are copied into Tavoro (up to 95 MB each).

**People** — Matched assignees, comment authors and watchers come over as themselves; the reporter becomes a watcher. Someone who isn’t a member shows as *Jane Doe (from Jira)* on their comments, and a card assigned to them comes over unassigned with a “From Jira” note. Nobody is invited or emailed.

**Components and fix versions** — Labels such as *component: Onboarding* and *version: 2.1* (you can turn this off in the mapping).

**Not imported:** custom fields other than story points, worklogs, votes, workflows and automation, permission schemes, and change history — each card’s History starts with one “imported it from PROJ-123 on Jira” entry instead.

## Run it again

Importing the same projects again updates the cards it brought over before and adds new issues, comments and attachments. It never deletes anything, and it doesn’t overwrite a field someone has changed in Tavoro since the last import — the report counts those as left alone. That lets a team import, keep working in Jira for a while, and top up before switching over.

### Keys

If a project goes into an existing board with a different prefix, its cards get that board’s keys; the report lists old and new keys, and searching for the old Jira key still finds the card.

> **If an import stops.** An import that fails part way keeps what it already brought over, and the report says why it stopped. Running it again picks up without duplicating anything. **Cancel import** stops a run the same way.

---

← [Connected apps](connected-apps.md) · [All guides](README.md) · [Members, groups & access](members-access.md) →
