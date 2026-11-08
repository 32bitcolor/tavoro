import Link from "next/link";
import { Lead, H2, H3, P, UL, LI, Steps, Callout, DefList, Def, UI, Screenshot } from "@/components/help/prose";

export default function Projects() {
  return (
    <>
      <Lead>
        <strong>Projects</strong> are the instructional-design planning heart of Tavoro. A project
        holds the whole shape of a build: the methodology and its phases, the deliverables you owe,
        the SME and stakeholder reviews they go through, your milestones, and the time logged against
        it all — one place to answer &ldquo;where is this, and what&rsquo;s left?&rdquo;
      </Lead>

      <H2>Create a project and pick a methodology</H2>
      <P>
        Projects live under <UI>Projects</UI> in the sidebar. When you create one you choose a{" "}
        <strong>methodology</strong>, and Tavoro seeds the matching phases so you start with real
        structure instead of a blank page.
      </P>

      <Steps>
        <>
          Choose <UI>New project</UI> on the <UI>Projects</UI> page (or <UI>New → Project</UI> in the
          header) and type a name in <UI>Project name…</UI>.
        </>
        <>
          Pick <UI>ADDIE</UI>, <UI>SAM</UI>, or <UI>Custom (start empty)</UI> as the methodology, then
          choose <UI>Create</UI>. The project opens straight away.
        </>
        <>
          Open the project to set its overall <UI>Status</UI> (<UI>Active</UI>, <UI>On hold</UI>, or{" "}
          <UI>Completed</UI>) and add a description.
        </>
      </Steps>

      <P>
        Not sure which methodology fits? See{" "}
        <Link href="/help/addie-sam" className="underline underline-offset-2">
          ADDIE vs. SAM
        </Link>{" "}
        for what each is and when to reach for it. ADDIE seeds five phases, SAM seeds three, and
        Custom starts empty for you to build your own.
      </P>
      <P>
        Run the same kind of project often? Save one as a template and pick it under <UI>Start from</UI> next time: see{" "}
        <Link href="/help/templates" className="underline underline-offset-2">
          Templates
        </Link>
        .
      </P>

      <H2>Phases</H2>
      <Screenshot name="project" alt="A project page with its phase, next milestone and alignment summary, the phases list, and the Boards section" caption="A project: phase progress, next milestone, alignment, then phases and boards." />
      <P>
        Phases are the stages your project moves through. Each one carries a status and optional
        start/end dates, and the project card in the grid shows a live <em>done / total</em> progress
        bar built from them.
      </P>
      <UL>
        <LI>
          <strong>Advance the status</strong> — click a phase&rsquo;s status badge to cycle it{" "}
          <UI>Not started</UI> → <UI>In progress</UI> → <UI>Done</UI>.
        </LI>
        <LI>
          <strong>Set dates</strong> — fill in <UI>Start</UI> and <UI>End</UI> to plan the timeline.
        </LI>
        <LI>
          <strong>Reorder or edit</strong> — use the up and down arrows to move a phase, click its name
          to rename it, and its delete button to remove it. Add more with <UI>Add a phase</UI>.
        </LI>
      </UL>

      <Callout tone="note">
        The seeded phases are a starting point, not a cage. Add, rename, reorder, or remove them
        freely so the pipeline matches how this particular project actually runs.
      </Callout>

      <H2>Boards</H2>
      <P>
        A project&rsquo;s <UI>Boards</UI> section lists the boards that carry its day-to-day work. Use{" "}
        <UI>Add a board</UI> to create one inside the project, or <UI>Add existing board…</UI> to bring
        in a standalone board. A project&rsquo;s boards show the project&rsquo;s phase, next milestone,
        and objective alignment above their columns.
      </P>

      <H2>Deliverables</H2>
      <P>
        Deliverables are the things you&rsquo;re actually producing — a storyboard, an assessment, a job
        aid. Add one with <UI>+ Add a deliverable</UI>, then set its type, status, and phase, and
        optionally connect it to the work happening elsewhere in the app.
      </P>

      <H3>Type</H3>
      <P>
        Pick what the deliverable is: <UI>Storyboard</UI>, <UI>Assessment</UI>,{" "}
        <UI>Job aid</UI>, <UI>Video</UI>, <UI>Document</UI>, or <UI>Other</UI>. When the type is{" "}
        <UI>Storyboard</UI>, a <UI>Create storyboard</UI> button appears — one click spins up a linked
        storyboard (and <UI>Open storyboard</UI> jumps to it thereafter).
      </P>

      <H3>Status</H3>
      <DefList>
        <Def term="Not started">Queued — no work begun yet.</Def>
        <Def term="In progress">Actively being built.</Def>
        <Def term="In review">Out with a SME or stakeholder for feedback.</Def>
        <Def term="Complete">Done and approved.</Def>
      </DefList>

      <H3>Link to a board card</H3>
      <P>
        Use the <UI>Link a card…</UI> dropdown to tie a deliverable to a specific board card, so the
        plan and the day-to-day execution point at the same work. Once linked, the card title shows as
        a chip you can follow straight to its board; the <UI>×</UI> unlinks it.
      </P>

      <H2>Review rounds</H2>
      <Screenshot name="review-round" alt="A review round: the reviewers and their decisions at the top, the storyboard as reviewed on the left, and comments on the right" caption="Round 2 of a storyboard review, with pinned comments beside the screens." />
      <P>
        Every deliverable has its own <strong>review rounds</strong>: the SME and stakeholder sign-off
        loop that&rsquo;s the daily bottleneck for most ID teams. Each round freezes a copy of the linked
        storyboard, so reviewers comment on exactly what you sent, even if you keep editing.
      </P>

      <Steps>
        <>
          On a deliverable, click <UI>Request a review</UI> and choose what&rsquo;s being reviewed: the
          linked storyboard, or a <strong>PDF, image or video</strong> you upload (for example, a
          Storyline or Rise export, or a screen recording of the course). Pick reviewers from your workspace, and/or add <strong>guests</strong> by name and
          email for SMEs who don&rsquo;t have an account. Set a due date and click <UI>Start round 1</UI>.
          Everyone is emailed a link.
        </>
        <>
          Reviewers select text in any storyboard field and comment on it. On a PDF or image, they click
          to drop a numbered pin or drag to mark an area. On a PDF, they can also select text and choose
          <UI>Comment on selection</UI> to quote it. On a video, they play to a moment and choose{" "}
          <UI>Comment at 1:23</UI>, or <UI>Pin on the frame</UI> to point at something in the picture;
          numbered markers on the timeline under the video jump back to each comment. They can also
          leave general feedback.
          Then they choose <UI>Approve</UI>, <UI>Approve with minor changes</UI>, or{" "}
          <UI>Request changes</UI>. The round passes only when <strong>every</strong> reviewer approves
          (with or without minor changes).
        </>
        <>
          Reply to comments, and mark them <UI>Resolved</UI> or <UI>Won&rsquo;t fix</UI> with a note the
          reviewer sees. Then start the next round: it goes back to the same people, and the review page
          highlights what changed since the last one.
        </>
      </Steps>

      <Callout tone="tip">
        Reviewing a file? PDFs, PNG, JPEG, WebP or GIF images, and MP4 or WebM videos up to 95 MB work.
        For an e-learning build, publish it to PDF (Storyline: <UI>Publish → Print</UI>), or record a
        walkthrough video, and upload that. For video, export at 720p to stay under the limit. Tavoro shows
        files; it never runs them. For the next round, upload the new version, or reuse the same file.
      </Callout>

      <H3>Guest reviewers</H3>
      <P>
        A guest gets a personal link that opens just that one round: no account, no sidebar, nothing
        else in your workspace. Guests can&rsquo;t @-mention anyone, and they never see member email
        addresses. A link lasts until two weeks after the due date (90 days at most). After a guest
        decides, their page is read-only unless they reopen their decision.
      </P>
      <UL>
        <LI>
          On the round page, a guest&rsquo;s <UI>⋯</UI> menu lets you copy their link, re-send the
          invite, reset the link (the old one stops working), or turn it off.
        </LI>
        <LI>
          Starting a new round sends each guest a new link. Links from earlier rounds become read-only.
        </LI>
        <LI>Guests and members with an undecided review get a reminder the day before it&rsquo;s due.</LI>
      </UL>

      <Callout tone="tip">
        Admins and managers can <UI>Override</UI> a round to pass it without every approval, for
        example when an SME has gone silent. A reason is required, and it&rsquo;s shown on the round.
      </Callout>

      <H3>Turn feedback into work</H3>
      <Screenshot name="feedback" alt="The All feedback view listing every comment on a deliverable from every round, grouped by screen" caption="All feedback: every comment from every round, ready to resolve or send to a board." />
      <P>
        Review comments become board cards, so fixing them happens where the rest of your work does.
      </P>
      <UL>
        <LI>
          On any open comment, click <UI>Send to board</UI>. Pick a board and column, and Tavoro makes a
          card that quotes the comment and links back to it. The comment shows the card&rsquo;s key.
        </LI>
        <LI>
          <UI>All feedback</UI> (on the deliverable, or at the top of a round) lists every comment from every
          round, grouped by screen or page. Filter by reviewer, round, or whether it&rsquo;s on a board yet,
          then select several to resolve them together or send them to a board: one card each, or one card
          with a subtask per comment.
        </LI>
        <LI>
          A card made from feedback lists its comments under <UI>Review feedback</UI>. When the card is
          done (or a comment&rsquo;s subtask is ticked), it offers to resolve the comments, so the reviewer
          sees the outcome.
        </LI>
      </UL>

      <H3>Export</H3>
      <P>
        <UI>Export</UI> on a round gives you a <strong>Word document</strong> or a <strong>PDF</strong> (a
        print view: choose <UI>Save as PDF</UI> in the print dialog). It lists the reviewers and their
        decisions, then every screen with each comment beside the field it&rsquo;s about, or each page of a
        reviewed file with its comments. Storyboards have the same <UI>Export</UI> menu, without comments.
      </P>

      <H2>Milestones and time tracking</H2>
      <P>
        <strong>Milestones</strong> are the dated checkpoints that matter — a kickoff, a pilot, a
        go-live. Add one with <UI>Add a milestone</UI>, give it a due date, and check it off when
        it&rsquo;s hit; overdue, uncompleted milestones show their date in red. Upcoming milestones
        also surface on your home dashboard and in My Work.
      </P>
      <P>
        <strong>Time tracking</strong> records effort against the project. Click <UI>+ Log time</UI>,
        enter the date and hours, optionally attribute it to a deliverable and add a note, then click{" "}
        <UI>Log</UI>. The section header keeps a running total of hours logged across the whole
        project.
      </P>

      <H2>Sprint planning</H2>
      <P>
        A project can opt into <strong>sprints</strong> — time-boxed iterations the team runs on a
        shared board. Turn on <UI>Sprint planning</UI> on the project to make its board cards
        assignable to a sprint; from there they show up on the team sprint board grouped by status.
        See the{" "}
        <Link href="/help/sprints" className="underline underline-offset-2">
          Sprints
        </Link>{" "}
        guide for how sprints work end to end.
      </P>

      <Callout tone="note">
        Projects are visible to all workspace members by default. An admin can restrict a project to
        specific groups in <UI>Settings → Groups</UI>; once restricted, only those groups (plus admins
        and managers) can see it in the list, on the dashboard, or via a direct link.
      </Callout>
    </>
  );
}
