<!-- Generated from src/components/help by `npm run help:export`. Edit the app's help, not this file. -->

# Automation rules

> Automation rules do routine card work for the team: *when* something happens to a card, *if* the card matches a query, *then* change it or tell someone. Admins manage them in **Settings → Automation**.

## Make a rule

1. Click **New rule**, name it, and choose whether it applies to every board or one.
2. Pick what starts it (**When**).
3. Optionally narrow it with a condition (**If**) — the same query language as the Cards page, like `priority >= high AND labels = qa`. **Check** shows how many cards match now.
4. Add up to ten actions (**Then**), and **Save rule**. Tavoro checks the statuses, labels, fields and people it names exist before saving.

## When

**A card is created** — Including cards made by MCP and templates; not cards brought in by a Jira import.

**A card's status changes** — Optionally only to one status — “to Done”.

**A field changes** — Assignee, priority, labels, due date, type, estimate, sprint, epic, or a custom field.

**Someone comments** — Any new comment on the card.

**All of a card's subtasks are done** — When the last open subtask is ticked off.

**A due date is coming up** — Checked every day at 07:00 UTC: cards due in exactly N days (0 = today) that aren’t done.

**On a schedule** — Every day, or every Monday, at 07:00 UTC, for every card that matches the condition (a condition is required; at most 200 cards a run).

## Then

- move it to a status (its board needs a column for that status)
- assign or unassign someone, add a watcher
- set the priority, the due date (N days from the day it runs), or a custom field
- add or remove a label
- add a comment (shown as from the rule) or a subtask
- email its assignees, its watchers, or a person, with your message and a link to the card

### Examples

- When the status changes to *In review*, if `sme is not EMPTY`: add the label *needs SME*.
- When all subtasks are done: move it to *In review*.
- When a due date is 2 days away, if `assignee is EMPTY`: email Maya “Nobody’s on this yet”.
- Every Monday, if `status = Backlog AND updated < -30d`: add the label *stale*.

## What you’ll see

Rules run in the background a moment after the change. Each card’s History shows what a rule did, as *Automation · rule name*. Each rule keeps a log of its last 200 runs — open it under the rule — with any problem spelled out, such as a status that was renamed. Turn a rule off with its **On** switch.

> **Rules and email.** A rule’s changes don’t send the usual notifications (an assignment by a rule doesn’t email the assignee); use the **Email people** action when someone should know.

> **Rules that trigger rules.** A rule’s changes can start other rules — up to three in a chain, and at most ten rule runs on one card per minute. Past that, the run log says it stopped, so two rules can’t loop forever.

---

← [Reports](reports.md) · [All guides](README.md) · [Connected apps](connected-apps.md) →
