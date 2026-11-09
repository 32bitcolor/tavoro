<!-- Generated from src/components/help by `npm run help:export`. Edit the app's help, not this file. -->

# Sprints

> A **sprint** is a time-boxed iteration for your whole team — a named window with a goal and start and end dates that pulls cards from across your boards into one focused push. Where boards run the pipeline and projects hold the plan, sprints are the cadence: “here’s what we’re finishing together in the next two weeks.”

## Create a sprint

Sprints live under **Sprints** in the sidebar. Every sprint belongs to your workspace, so a single sprint can gather cards from any board or project the team is working across.

1. On the **Sprints** page, type a name into **New sprint name…**, optionally add a one-line goal in **Goal (optional)**, and click **Create sprint**. The new sprint appears at the top of the list.
2. Set its window with the two date fields on the sprint row — a start date, the **→** arrow, and an end date. Both are optional, but they’re what makes the sprint a real time box.
3. Rename a sprint by clicking its title, and edit its goal in place. The count beside the name shows how many cards are currently in the sprint.

## The Backlog

The **Backlog** (the button at the top of the Sprints page, or **Backlog** on any sprint board) is where you plan. It lists your active and planned sprints, each as a section, and then **Backlog**: every open card that isn’t in a sprint, from every board you can see. Epics aren’t listed themselves — their cards are.

- **Rank** — drag a card up or down to set its priority. The order is one list across all boards, so it’s the team’s priority, not one board’s. New cards start at the bottom.
- **Plan** — drag a card from the backlog into a sprint, between sprints, or back out. Each section shows its card count and estimate total, so you can see when a sprint is full.
- **Without dragging** — every card has a **⋯** menu with **Move to top**, **Move to bottom**, and each sprint (or **Backlog**).
- **Filter** — search by title or key, or filter by type, priority, assignee, label and project. The **Epics** panel on the left shows each open epic’s progress; click one to see only its cards.

Click a card to open it in the card panel. **Create sprint** on the Backlog section adds the next sprint (*Sprint 43* after *Sprint 42*).

## Start and complete a sprint

**Planned** — A new sprint. Plan cards into it from the Backlog. **Start sprint** asks for its name, dates (today for two weeks, unless you set dates already) and goal, and makes it active. What the sprint holds when it starts is recorded, so later reports can tell planned work from work added mid-sprint.

**Active** — The sprint is running. When it ends, click **Complete sprint** (on the Backlog, the Sprints page or the sprint board). It shows how many cards are done and asks where the unfinished ones go: a planned sprint, a **New sprint**, or the **Backlog**.

**Completed** — Done cards stay with the sprint, and its result is kept — for example *8 of 10 cards done · 21 of 26 pts* — on the Sprints page and the sprint board. A completed sprint is closed to new cards. **Reopen** makes it active again if you completed it by mistake.

> **Sprint status and card status.** A sprint’s status is separate from the status of the cards in it. A card is “done” for a sprint when its status is in the **Done** category.

## Sprint report and burndown

Every started sprint has a **Report** (on its sprint board, its Backlog section and the Sprints page). It shows what the sprint committed to when it started, what’s done and not done, how many cards were added after the start, and where unfinished cards went.

The **burndown** plots the work remaining each day — in points if the sprint’s cards have estimates, otherwise in cards — against a dashed ideal line from the starting total down to zero on the last day. Tavoro records each sprint’s progress every night while it’s active, and when it starts and completes; days before that have no point. Hover or use the arrow keys for a day’s numbers, or open **Show as table**.

**Velocity** — committed vs. completed across recent sprints — is in **Reports → Sprints**.

## Roadmap

**Sprints → Roadmap** lays out epics from every board on a timeline, from their **start date** to their **due date**, each bar filled by how many of its cards are done. Epics have a **Start date** field in the card panel. On the roadmap, drag a bar to move it, or drag either end to change one date; click a bar to open the epic. Switch between **Months** and **Quarters**, filter by board, and show done epics if you want them. Epics with no dates are listed underneath.

## The sprint board

![A sprint board with cards from several boards grouped by status columns, and Project, Assignee and Label filters](../../public/help-shots/sprint-board.png)
*Sprint 42's board: cards from across projects, grouped by status.*

Click **Open board** on any sprint (or **Sprint board** on the Backlog) to see its cards laid out as a Kanban view. Instead of the columns a single board uses, the sprint board groups every card by your workspace’s statuses — by default **Backlog**, **To do**, **In progress**, **In review**, and **Done** — so a mix of cards from different boards reads as one shared picture of progress.

Each card shows its type, key, priority, home project, labels, estimate, due date, and assignees. If any card has an estimate, each column shows its total next to the card count, and the header shows how much of the sprint is done (for example, *13 of 21 pts done*). Click a card to open the same full card drawer you use on a board — description, subtasks, comments, attachments, and all. Filter the view with the **Project**, **Assignee**, **Label** and **Epic** pickers at the top; while a filter is on, the bar shows *N of M cards* and **Clear** resets it. Filtering by label works across projects because labels belong to the workspace, not to a single board. Keep a combination you use often by opening **Views** → **Save current filters…**; sprint views are personal to you and available on every sprint board.

### Moving cards changes their status

Drag a card from one status column to another and it updates that card’s canonical status everywhere — this is the same status the card carries on its home board, not a sprint-only setting. Because it’s a real status change, it sends the usual status-change notification to people watching the card.

> **Notifications.** The email that goes out when a card’s status changes is covered in the Notifications article — sprint moves are just one of the places that trigger it.

## Getting cards onto a sprint

The Backlog is the main way to plan. There are two more ways to add a card to a sprint, and all of them do the same thing under the hood.

- **From the sprint board** — click **Add cards**, search by title or card key, and click **Add** next to each one. The picker lists cards that aren’t already in a sprint.
- **From a card** — open any card and set its **Sprint** field to the sprint (or back to **No sprint** to remove it). This is handy when you’re already working on a board and want to tag a card as you go.

Removing a card from a sprint never deletes it — the card stays on its home board. The same is true if you delete the sprint itself: its cards stay put and simply lose the sprint tag.

## Turning on sprint planning

The **Sprint** field only shows on a card when its project has opted in. Open a project and toggle **Sprint planning** on to surface that field for the project’s cards, so the team can assign them to sprints without leaving the board.

> **Tip.** You can always add cards from the sprint board’s **Add cards** picker regardless of the toggle — the per-project switch is about whether the **Sprint** field appears directly on those cards.

### How sprints fit boards and projects

Think of the three as layers that point at the same work. **Boards** are the pipeline — the day-to-day columns and cards. **Projects** are the plan — phases, reviews, and deliverables over time. **Sprints** are the team’s cadence, reaching across boards and projects to pull a slice of cards into one time-boxed iteration. A card can live on a board, belong to a project, and ride in a sprint all at once, and updating its status in any of those views updates it in all of them.

---

← [Projects](projects.md) · [All guides](README.md) · [Storyboards](storyboards.md) →
