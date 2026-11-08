import { Lead, H2, H3, P, UL, LI, Steps, Callout, DefList, Def, UI, Screenshot } from "@/components/help/prose";

export default function Boards() {
  return (
    <>
      <Lead>
        A <strong>board</strong> is a Kanban view of your production pipeline — columns you move
        cards across as work progresses. Each card holds the real detail: a rich-text description,
        due date, labels, assignees and SMEs, subtasks, comments, attachments, linked whiteboards,
        and any review feedback sent to it. It&rsquo;s where the day-to-day &ldquo;what&rsquo;s in
        flight and who has it&rdquo; lives.
      </Lead>

      <H2>Create a board and shape its columns</H2>
      <P>
        Boards live under <UI>Boards</UI> in the sidebar. A board can stand on its own or belong to a
        project (create it from the project&rsquo;s <UI>Boards</UI> section). A new board starts with
        three columns — <em>To do</em>, <em>In progress</em>, <em>Done</em> — that you reshape to match
        how your team works.
      </P>
      <Steps>
        <>
          Choose <UI>New board</UI> on the <UI>Boards</UI> page (or <UI>New → Board</UI> in the header
          from anywhere), type a name in <UI>Board name…</UI>, and choose <UI>Create</UI>. The new
          board opens straight away.
        </>
        <>
          Add a stage with the <UI>+</UI> at the right end of the columns: name it in{" "}
          <UI>Column name…</UI> and choose <UI>Add column</UI>.
        </>
        <>
          Rename a column by clicking its title. Its <UI>⋯</UI> menu has <UI>Move left</UI>,{" "}
          <UI>Move right</UI>, and <UI>Delete column…</UI> (which deletes the column and its cards).
        </>
        <>
          Rename the board by clicking its title. The <UI>⋯</UI> (<UI>Board settings</UI>) menu beside
          the view switch sets the <UI>Card prefix</UI>, shares the board publicly (see{" "}
          <em>Sharing a board publicly</em> below), and holds <UI>Delete board…</UI>, which permanently
          deletes every column and card on it.
        </>
      </Steps>

      <H3>Card keys</H3>
      <P>
        Give a board a <UI>Card prefix</UI> (for example <code>SEC</code>) and every card gets a short
        key like <code>SEC-12</code>, shown on the card and in the drawer. Keys make cards easy to
        mention in conversation and to refer to from AI assistants. Each board in a workspace needs its
        own prefix. Changing it re-labels the board&rsquo;s cards; the numbers stay the same.
      </P>

      <H2>Cards</H2>
      <Screenshot name="board" alt="A board with Backlog, To do and In progress columns of cards above the project strip and filter bar" caption="A project board: the project strip, the filter bar, and the columns." />
      <P>
        Add a card with <UI>Add card</UI> at the bottom of a column, or <UI>New card</UI> in the board
        header, then type a title in <UI>Card title…</UI>. To move a card, drag it: within a column to
        reorder, or across columns to change its stage. Dragging works with filters on, too — a
        dropped card lands next to the card you can see. Positions save automatically.
      </P>
      <P>
        The card face shows its state at a glance: key, labels, a due-date chip (red when overdue), a
        subtask count (green once every subtask is done), comment and attachment counts, and the
        assignees. Click a card to open its drawer.
      </P>

      <H3>Board and list views</H3>
      <Screenshot name="board-list" alt="The same board shown as a list grouped by column, with key, title, labels, people and due date" caption="List view: the same cards as a table, grouped by column." />
      <P>
        The <UI>Board</UI> / <UI>List</UI> switch in the header changes how the same cards are shown:
        columns you drag between, or a table grouped by column with key, title, priority, estimate,
        labels, due date and people. Filters apply to both. In the list, click the <UI>Priority</UI>,{" "}
        <UI>Points</UI> (or <UI>Hours</UI>) or <UI>Due</UI> heading to sort each column&rsquo;s cards by it;
        click it again to go back to the board&rsquo;s order.
      </P>

      <H2>The card drawer, in depth</H2>
      <Screenshot name="card-drawer" alt="An open card drawer showing the description, subtasks, status, due date, sprint, assignees, SMEs and labels" caption="The card drawer for SEC-13, with its subtasks and details." />
      <P>
        Opening a card slides in a drawer with everything about it. Changes save as you go — there&rsquo;s
        no save button. Press <UI>Esc</UI> or use <UI>Close card</UI> to close it; <UI>J</UI> and{" "}
        <UI>K</UI> step to the next and previous card, and <UI>Copy shareable link</UI> copies a link
        that opens this card for anyone who can see the board.
      </P>

      <DefList>
        <Def term="Title">Edit it at the top of the drawer; the card face updates when you click away.</Def>
        <Def term="Description">
          Rich text with bold, italic, a heading, and bulleted or numbered lists. Type <UI>@</UI> to
          mention a teammate who can see the card — they get an email with a link straight back to it.
        </Def>
        <Def term="Subtasks">
          Break the card down with <UI>Add a subtask…</UI>. Each subtask is a small card of its own:
          tick it done, give it an assignee, or open it. The section header shows{" "}
          <em>done / total</em>, mirrored on the card face. Subtasks assigned to you show in My Work.
        </Def>
        <Def term="Review feedback">
          When review comments are sent to a board as cards (from a review round or a deliverable&rsquo;s
          feedback view), the card lists them here with where they were left, so the fix and the comment
          stay together.
        </Def>
        <Def term="Type">
          <UI>Task</UI>, <UI>Bug</UI>, <UI>Story</UI> or <UI>Epic</UI>, shown as an icon before the
          card&rsquo;s key. New cards are tasks. An epic is a big piece of work that groups other cards, so it
          isn&rsquo;t planned in a sprint: making a card an epic takes it out of its sprint. Subtasks
          don&rsquo;t have a type.
        </Def>
        <Def term="Priority">
          <UI>Highest</UI>, <UI>High</UI>, <UI>Medium</UI>, <UI>Low</UI>, <UI>Lowest</UI>, or <UI>None</UI>.
          Shown as an arrow icon next to the key.
        </Def>
        <Def term="Estimate">
          How big the work is, in story points or hours (an admin picks which in{" "}
          <UI>Settings → Cards &amp; labels</UI>). Shown as a chip on the card, and totalled on the sprint
          board.
        </Def>
        <Def term="Status">
          The column the card is in. Changing it here moves the card. Each column maps to one of the
          workspace&rsquo;s statuses (to do, in progress, done and so on), which drive the sprint board and
          cross-board views; a status change notifies the card&rsquo;s assignees and SMEs.
        </Def>
        <Def term="Visibility">
          <UI>Private</UI> leaves the card off the board&rsquo;s public link, if it has one. A private card
          shows a <UI>Private</UI> tag on the board; members still see it as usual. Subtasks follow their
          card.
        </Def>
        <Def term="Due date">
          Pick a date, or <UI>Clear</UI> it. Due dates drive the due-date filter, the overdue chip, and
          reminder emails.
        </Def>
        <Def term="Sprint">
          On boards in a sprint-enabled project, assign the card to a <UI>Sprint</UI> to put it on that
          sprint&rsquo;s board (<UI>No sprint</UI> takes it off). See the Sprints guide.
        </Def>
        <Def term="Labels">
          Toggle any of the workspace&rsquo;s labels. Create one by typing in <UI>New label…</UI>, picking
          a color, and choosing <UI>Add</UI>. Labels are shared across the workspace; admins rename,
          recolor, and delete them in <UI>Settings → Cards &amp; labels</UI>.
        </Def>
        <Def term="Assignees and SMEs">
          <UI>+ Assign</UI> adds workspace members as assignees (who&rsquo;s doing it) or SMEs (who
          checks it for accuracy). Both are emailed when added and notified of comments, and assigned
          cards show in each person&rsquo;s My Work.
        </Def>
        <Def term="Attachments">
          Upload files up to 25 MB each, then <UI>Download</UI> or remove them.
        </Def>
        <Def term="Whiteboards">
          <UI>+ New whiteboard</UI> creates an Excalidraw canvas linked to this card, and lists any
          already linked — handy for wireframing a flow in context.
        </Def>
        <Def term="Comments">
          A rich-text discussion thread. Type <UI>@</UI> to mention someone (they&rsquo;re emailed); the
          card&rsquo;s assignees and SMEs are notified of new comments. You can delete your own comments,
          and admins can delete any.
        </Def>
      </DefList>

      <P>
        To remove a card, use <UI>Delete card</UI> at the bottom of the drawer, or the <UI>×</UI> that
        appears when you hover over a card on the board.
      </P>

      <H3>Moving a card to another board</H3>
      <P>
        Work sometimes lands on the wrong board, or moves to another team. Choose{" "}
        <UI>Move to board…</UI> at the bottom of the card&rsquo;s drawer, pick the <UI>Board</UI> and the{" "}
        <UI>Column</UI> (the one matching the card&rsquo;s current status is picked for you), and choose{" "}
        <UI>Move card</UI>. It lands at the bottom of that column, and a note on the board you left links
        to it.
      </P>
      <UL>
        <LI>
          <strong>Everything comes along:</strong> subtasks, comments, attachments, labels, assignees and
          SMEs, linked whiteboards, review feedback, and its Private setting.
        </LI>
        <LI>
          <strong>It gets a new key</strong> from the new board (say, <code>SEC-12</code> becomes{" "}
          <code>OPS-31</code>; its subtasks get new keys too). The old key keeps working: short links,
          search and AI assistants still find the card by it.
        </LI>
        <LI>
          <strong>Its status</strong> becomes the column&rsquo;s, and assignees and SMEs are told if that
          changes it. If the new board belongs to a project that doesn&rsquo;t plan in sprints, the card
          leaves its sprint.
        </LI>
        <LI>
          You can move a card to any board in the workspace you can see. Subtasks move with their card, not
          on their own.
        </LI>
      </UL>

      <H2>Filtering the board</H2>
      <P>
        The filter bar above the columns narrows what&rsquo;s visible without changing anything. Filters
        stack, so you can answer questions like &ldquo;overdue cards assigned to me with the{" "}
        <em>Compliance</em> label&rdquo;. While any filter is on, the bar shows <em>N of M cards</em>;{" "}
        <UI>Clear</UI> resets them all.
      </P>
      <UL>
        <LI>
          <strong>Search</strong> — type in <UI>Search cards</UI> to match card titles. (To jump to a card by its key, use the header&rsquo;s <UI>Search</UI>.)
        </LI>
        <LI>
          <strong>Label</strong> and <strong>Assignee</strong> — open each and check the ones to filter
          by; the button shows what&rsquo;s selected.
        </LI>
        <LI>
          <strong>Type</strong> and <strong>Priority</strong> — for example, only bugs, or only{" "}
          <UI>Highest</UI> and <UI>High</UI>. <UI>No priority</UI> finds cards nobody has prioritised yet.
        </LI>
        <LI>
          <strong>Due date</strong> — <UI>Any due date</UI>, <UI>Overdue</UI>, <UI>Due this week</UI>, or{" "}
          <UI>No due date</UI>.
        </LI>
      </UL>

      <H3>Saved views</H3>
      <P>
        Once you&rsquo;ve set up a combination of filters you keep coming back to, open <UI>Views</UI>{" "}
        and choose <UI>Save current filters…</UI> to name it. Pick it from that menu any time to
        re-apply the whole combination; <UI>Clear view</UI> goes back to everything. Saved views are{" "}
        <strong>yours</strong>, not shared with the workspace, and a board&rsquo;s views stay with that
        board. Saving over a name you&rsquo;ve already used updates that view, and changing a filter by
        hand detaches the view so the menu never names one while showing something else. The team
        sprint board has its own <UI>Views</UI> menu that works the same way.
      </P>

      <H2>Sharing a board publicly</H2>
      <P>
        A public link lets people outside the workspace (a stakeholder, a client, the rest of the
        company) follow a board without an account. They see it read-only: they can&rsquo;t change
        anything, and the link never leads anywhere else in Tavoro.
      </P>
      <Screenshot name="share-dialog" alt="The Share this board publicly dialog with the link, a Copy button, the Show who's assigned option, and Reset link and Stop sharing" caption="Board ⋯ → Share publicly…: the link and its options." />
      <Steps>
        <>
          Open the board&rsquo;s <UI>⋯</UI> (<UI>Board settings</UI>) menu and choose{" "}
          <UI>Share publicly…</UI>, then <UI>Create public link</UI>.
        </>
        <>
          <UI>Copy</UI> the link and send it. While it&rsquo;s on, the board header shows{" "}
          <UI>Public link on</UI>; click it to come back to these settings.
        </>
        <>
          Mark any card that shouldn&rsquo;t be seen <UI>Private</UI>, in its drawer under{" "}
          <UI>Visibility</UI>.
        </>
      </Steps>
      <Screenshot name="card-private" alt="A card drawer with Visibility set to Private, and the card on the board showing a Private tag" caption="A private card: the Private tag on the board, and Visibility in the drawer." />
      <DefList>
        <Def term="What visitors see">
          The columns, and each card that isn&rsquo;t private: its key, title, labels, due date, subtask
          progress, and description (mentions show as plain names). Click a card to read its description.
          The page shows the board as it is now, so a refresh picks up changes.
        </Def>
        <Def term="What they never see">
          Private cards, comments, attachments, subtask titles, SMEs, review feedback, whiteboards, and
          email addresses. Assignees only when you tick <UI>Show who&rsquo;s assigned</UI>, and then by
          name only.
        </Def>
        <Def term="Reset link and Stop sharing">
          <UI>Reset link…</UI> makes a new link and stops the old one working, for when it went somewhere it
          shouldn&rsquo;t. <UI>Stop sharing</UI> turns the link off; a stopped or reset link shows a
          not-found page.
        </Def>
      </DefList>
      <Screenshot name="public-board" alt="The public, read-only board: columns of cards with keys, labels and due dates, a filter box, and no editing controls" caption="What a visitor sees. The private card isn't there." />
      <Callout tone="warning">
        Anyone who has the link can open it, and can pass it on. Treat it like the board is public, and
        mark cards private before sharing, not after.
      </Callout>
      <P>
        Anyone who can work on a board can share it, from the browser only (an AI assistant connected over
        MCP can mark cards private but can&rsquo;t publish a board). Admins see every shared board in{" "}
        <UI>Settings → Sharing</UI>, can turn any link off there, and can switch public links off for the
        whole workspace.
      </P>
      <Screenshot name="sharing-settings" alt="Settings → Sharing: the public board links switch and the list of shared boards, with Open and Turn off link" caption="Settings → Sharing, for admins." />

      <H3>How boards fit the pipeline</H3>
      <P>
        Boards are the execution layer beneath your projects. A project&rsquo;s board shows a strip
        with the project&rsquo;s current phase, next milestone, and objective alignment above the
        columns, and a deliverable can link to a specific card, so the planning view and the doing view
        point at the same work. Use projects to plan the <em>what</em> and <em>when</em>; use boards to
        run the day-to-day.
      </P>

      <Callout tone="note">
        By default every workspace member can see a board. An admin can restrict it to specific groups
        in <UI>Settings → Groups</UI> — once restricted, only members of those groups (plus admins and
        managers) can find or open it, anywhere in the app.
      </Callout>
    </>
  );
}
