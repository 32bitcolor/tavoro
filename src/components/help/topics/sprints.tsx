import { Lead, H2, H3, P, UL, LI, Steps, Callout, DefList, Def, UI, Screenshot } from "@/components/help/prose";

export default function Sprints() {
  return (
    <>
      <Lead>
        A <strong>sprint</strong> is a time-boxed iteration for your whole team &mdash; a named
        window with a goal and start and end dates that pulls cards from across your boards into one
        focused push. Where boards run the pipeline and projects hold the plan, sprints are the
        cadence: &ldquo;here&rsquo;s what we&rsquo;re finishing together in the next two weeks.&rdquo;
      </Lead>

      <H2>Create a sprint</H2>
      <P>
        Sprints live under <UI>Sprints</UI> in the sidebar. Every sprint belongs to your workspace,
        so a single sprint can gather cards from any board or project the team is working across.
      </P>

      <Steps>
        <>
          On the <UI>Sprints</UI> page, type a name into <UI>New sprint name…</UI>, optionally add a
          one-line goal in <UI>Goal (optional)</UI>, and click <UI>Create sprint</UI>. The new sprint
          appears at the top of the list.
        </>
        <>
          Set its window with the two date fields on the sprint row &mdash; a start date, the{" "}
          <UI>→</UI> arrow, and an end date. Both are optional, but they&rsquo;re what makes the
          sprint a real time box.
        </>
        <>
          Rename a sprint by clicking its title, and edit its goal in place. The count beside the
          name shows how many cards are currently in the sprint.
        </>
      </Steps>

      <H2>The Backlog</H2>
      <P>
        The <UI>Backlog</UI> (the button at the top of the Sprints page, or <UI>Backlog</UI> on any
        sprint board) is where you plan. It lists your active and planned sprints, each as a section,
        and then <strong>Backlog</strong>: every open card that isn&rsquo;t in a sprint, from every
        board you can see. Epics aren&rsquo;t listed themselves &mdash; their cards are.
      </P>
      <UL>
        <LI>
          <strong>Rank</strong> &mdash; drag a card up or down to set its priority. The order is one
          list across all boards, so it&rsquo;s the team&rsquo;s priority, not one board&rsquo;s. New
          cards start at the bottom.
        </LI>
        <LI>
          <strong>Plan</strong> &mdash; drag a card from the backlog into a sprint, between sprints, or
          back out. Each section shows its card count and estimate total, so you can see when a sprint
          is full.
        </LI>
        <LI>
          <strong>Without dragging</strong> &mdash; every card has a <UI>⋯</UI> menu with{" "}
          <UI>Move to top</UI>, <UI>Move to bottom</UI>, and each sprint (or <UI>Backlog</UI>).
        </LI>
        <LI>
          <strong>Filter</strong> &mdash; search by title or key, or filter by type, priority, assignee,
          label and project. The <UI>Epics</UI> panel on the left shows each open epic&rsquo;s progress;
          click one to see only its cards.
        </LI>
      </UL>
      <P>
        Click a card to open it in the card panel. <UI>Create sprint</UI> on the Backlog section adds
        the next sprint (<em>Sprint 43</em> after <em>Sprint 42</em>).
      </P>

      <H2>Start and complete a sprint</H2>
      <DefList>
        <Def term="Planned">
          A new sprint. Plan cards into it from the Backlog. <UI>Start sprint</UI> asks for its name,
          dates (today for two weeks, unless you set dates already) and goal, and makes it active. What
          the sprint holds when it starts is recorded, so later reports can tell planned work from work
          added mid-sprint.
        </Def>
        <Def term="Active">
          The sprint is running. When it ends, click <UI>Complete sprint</UI> (on the Backlog, the
          Sprints page or the sprint board). It shows how many cards are done and asks where the
          unfinished ones go: a planned sprint, a <UI>New sprint</UI>, or the <UI>Backlog</UI>.
        </Def>
        <Def term="Completed">
          Done cards stay with the sprint, and its result is kept &mdash; for example{" "}
          <em>8 of 10 cards done · 21 of 26 pts</em> &mdash; on the Sprints page and the sprint board.
          A completed sprint is closed to new cards. <UI>Reopen</UI> makes it active again if you
          completed it by mistake.
        </Def>
      </DefList>
      <Callout tone="note" title="Sprint status and card status">
        A sprint&rsquo;s status is separate from the status of the cards in it. A card is
        &ldquo;done&rdquo; for a sprint when its status is in the <UI>Done</UI> category.
      </Callout>

      <H2>The sprint board</H2>
      <Screenshot name="sprint-board" alt="A sprint board with cards from several boards grouped by status columns, and Project, Assignee and Label filters" caption="Sprint 42's board: cards from across projects, grouped by status." />
      <P>
        Click <UI>Open board</UI> on any sprint (or <UI>Sprint board</UI> on the Backlog) to see its cards laid out as a Kanban view. Instead
        of the columns a single board uses, the sprint board groups every card by your
        workspace&rsquo;s statuses &mdash; by default <UI>Backlog</UI>, <UI>To do</UI>,{" "}
        <UI>In progress</UI>, <UI>In review</UI>, and <UI>Done</UI> &mdash; so a mix of cards from
        different boards reads as one shared picture of progress.
      </P>
      <P>
        Each card shows its type, key, priority, home project, labels, estimate, due date, and
        assignees. If any card has an estimate, each column shows its total next to the card count, and
        the header shows how much of the sprint is done (for example, <em>13 of 21 pts done</em>). Click a card
        to open the same full card drawer you use on a board &mdash; description, subtasks,
        comments, attachments, and all. Filter the view with the <UI>Project</UI>,{" "}
        <UI>Assignee</UI>, <UI>Label</UI> and <UI>Epic</UI> pickers at the top; while a filter is on, the bar shows{" "}
        <em>N of M cards</em> and <UI>Clear</UI> resets it. Filtering by label works across projects because
        labels belong to the workspace, not to a single board. Keep a combination you use often by
        opening <UI>Views</UI> → <UI>Save current filters…</UI>; sprint views are personal to you and
        available on every sprint board.
      </P>

      <H3>Moving cards changes their status</H3>
      <P>
        Drag a card from one status column to another and it updates that card&rsquo;s canonical
        status everywhere &mdash; this is the same status the card carries on its home board, not a
        sprint-only setting. Because it&rsquo;s a real status change, it sends the usual status-change notification to
        people watching the card.
      </P>

      <Callout tone="note" title="Notifications">
        The email that goes out when a card&rsquo;s status changes is covered in the Notifications
        article &mdash; sprint moves are just one of the places that trigger it.
      </Callout>

      <H2>Getting cards onto a sprint</H2>
      <P>
        The Backlog is the main way to plan. There are two more ways to add a card to a sprint, and
        all of them do the same thing under the hood.
      </P>
      <UL>
        <LI>
          <strong>From the sprint board</strong> &mdash; click <UI>Add cards</UI>, search by title or
          card key, and click <UI>Add</UI> next to each one. The picker lists cards that aren&rsquo;t
          already in a sprint.
        </LI>
        <LI>
          <strong>From a card</strong> &mdash; open any card and set its <UI>Sprint</UI> field to the
          sprint (or back to <UI>No sprint</UI> to remove it). This is handy when you&rsquo;re already
          working on a board and want to tag a card as you go.
        </LI>
      </UL>
      <P>
        Removing a card from a sprint never deletes it &mdash; the card stays on its home board. The
        same is true if you delete the sprint itself: its cards stay put and simply lose the sprint
        tag.
      </P>

      <H2>Turning on sprint planning</H2>
      <P>
        The <UI>Sprint</UI> field only shows on a card when its project has opted in. Open a project
        and toggle <UI>Sprint planning</UI> on to surface that field for the project&rsquo;s cards, so
        the team can assign them to sprints without leaving the board.
      </P>
      <Callout tone="tip">
        You can always add cards from the sprint board&rsquo;s <UI>Add cards</UI> picker regardless of
        the toggle &mdash; the per-project switch is about whether the <UI>Sprint</UI> field appears
        directly on those cards.
      </Callout>

      <H3>How sprints fit boards and projects</H3>
      <P>
        Think of the three as layers that point at the same work. <strong>Boards</strong> are the
        pipeline &mdash; the day-to-day columns and cards. <strong>Projects</strong> are the plan
        &mdash; phases, reviews, and deliverables over time. <strong>Sprints</strong> are the
        team&rsquo;s cadence, reaching across boards and projects to pull a slice of cards into one
        time-boxed iteration. A card can live on a board, belong to a project, and ride in a sprint
        all at once, and updating its status in any of those views updates it in all of them.
      </P>
    </>
  );
}
