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
        <>
          Move the sprint through its life with the status dropdown &mdash; <UI>Planned</UI> while
          you&rsquo;re still gathering cards, <UI>Active</UI> once work is underway, and{" "}
          <UI>Completed</UI> when the window closes.
        </>
      </Steps>

      <Callout tone="note" title="Sprint status">
        A sprint&rsquo;s status is its own lifecycle &mdash; it&rsquo;s separate from the status of
        the cards inside it. Marking a sprint <UI>Completed</UI> is a record that the iteration is
        over; it doesn&rsquo;t move or close the cards on it.
      </Callout>

      <DefList>
        <Def term="Planned">
          The default for a new sprint. Use it while you&rsquo;re still deciding scope and pulling
          cards in.
        </Def>
        <Def term="Active">
          The sprint is running. This is the signal that the team is heads-down on these cards for
          the current window.
        </Def>
        <Def term="Completed">
          The window has closed. Cards that didn&rsquo;t finish keep living on their home boards &mdash;
          you can move them to the next sprint.
        </Def>
      </DefList>

      <H2>The sprint board</H2>
      <Screenshot name="sprint-board" alt="A sprint board with cards from several boards grouped by status columns, and Project, Assignee and Label filters" caption="Sprint 42's board: cards from across projects, grouped by status." />
      <P>
        Click <UI>Open board</UI> on any sprint to see its cards laid out as a Kanban view. Instead
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
        <UI>Assignee</UI>, and <UI>Label</UI> pickers at the top; while a filter is on, the bar shows{" "}
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
      <P>There are two ways to add a card to a sprint, and both do the same thing under the hood.</P>
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
