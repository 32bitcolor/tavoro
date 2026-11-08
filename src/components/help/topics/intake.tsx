import { Lead, H2, H3, P, Steps, Callout, DefList, Def, UI, Screenshot, Table } from "@/components/help/prose";

export default function Intake() {
  return (
    <>
      <Lead>
        <strong>Intake</strong> is the front door for training and content requests. Instead of L&amp;D
        catching asks over email, chat, and hallway conversations, every request comes in one way,
        gets triaged and scored, and either becomes a project or a documented no &mdash; so your team
        leads the work rather than reacting to whoever shouted loudest.
      </Lead>

      <H2>The public intake link</H2>
      <Screenshot name="intake-form" alt="The public intake form a stakeholder fills in, with name, email, what they need, details, audience and needed-by date" caption="The public request form. No sign-in needed." />
      <P>
        Every workspace has a public submission form at its own link &mdash; something like{" "}
        <UI>/request/your-workspace</UI>. Anyone with the link can submit a request; there&rsquo;s{" "}
        <strong>no login required</strong>, which is the point &mdash; stakeholders shouldn&rsquo;t
        need an account to ask for help. Requests they submit land in <UI>Intake</UI> for your team
        to triage.
      </P>

      <Steps>
        <>
          As a workspace admin, open <UI>Settings → Intake</UI>. You&rsquo;ll see the{" "}
          <UI>Public intake link</UI> panel with your shareable URL.
        </>
        <>
          Click <UI>Copy</UI> to grab the link, then share it however stakeholders reach you &mdash;
          an email signature, a team wiki, an internal portal, a Slack channel topic.
        </>
        <>
          To change the address (say, after renaming the workspace), choose <UI>Edit</UI>, type the new
          ending (lowercase letters, numbers and hyphens), and <UI>Save link</UI>. The old address keeps
          working and forwards to the new one, so links you&rsquo;ve already shared don&rsquo;t break.
        </>
        <>
          Use <UI>Enable intake form</UI> / <UI>Disable intake form</UI> to control whether the form
          accepts requests. While disabled, the link shows a not-found page, so you can pause intake
          without breaking anything you&rsquo;ve already shared.
        </>
      </Steps>

      <P>
        On the form, the requester fills in <UI>Your name</UI> and <UI>Your email</UI>,{" "}
        <UI>What do you need?</UI> (a short title), and <UI>Tell us more</UI> (the full description).
        Two optional fields help you triage: <UI>Audience</UI> and <UI>Needed by</UI>. On submit they
        get a confirmation screen with a reference number like <UI>REQ-14</UI>.
      </P>

      <H3>Your own questions</H3>
      <P>
        Under <UI>Settings → Intake → Your questions</UI>, admins can add up to 15 questions of their
        own: the business goal, how many people it&rsquo;s for, whether it&rsquo;s required for
        compliance. Each question can be a <UI>Short answer</UI>, a <UI>Paragraph</UI>, a{" "}
        <UI>Choice</UI> (one per line), <UI>Yes / no</UI> or a <UI>Date</UI>, with an optional hint, and
        can be required. Reorder them with the arrows, then choose <UI>Save questions</UI>; the form
        shows them straight away.
      </P>
      <P>
        Answers appear on the request, on the requester&rsquo;s status page, and in the description of
        the project the request becomes. Each answer is saved with the question as it was asked, so
        rewording or removing a question later never changes what earlier requesters said.
      </P>

      <Callout tone="note" title="Spam protection">
        The form has a hidden honeypot field that real people never see &mdash; if it&rsquo;s filled
        in, the submission is silently dropped. Each network can also submit only five requests an
        hour, so a bot (or an over-eager tab) can&rsquo;t flood your queue.
      </Callout>

      <H2>The triage queue</H2>
      <Screenshot name="intake-queue" alt="The Intake queue with Open, Converted and Rejected tabs, a search box, and requests showing their reference numbers, status, scores and quadrant" caption="The triage queue: open requests, unscored first, then by priority." />
      <P>
        Everything that comes in appears on the <UI>Intake</UI> page in the sidebar. Three tabs split
        the queue: <UI>Open</UI> (submitted, triaging, or waiting on the requester), <UI>Converted</UI>,
        and <UI>Rejected</UI>, each with its count. On the Open tab the work that needs attention floats
        up: untriaged requests first, then everything you&rsquo;ve scored, ordered by priority &mdash;
        highest first. The other two tabs list the most recent decisions first.
      </P>
      <P>
        Each row shows the reference number, current status, an impact/effort quadrant once scored, and
        the <UI>Needed by</UI> date (highlighted when it&rsquo;s close or past). <UI>Search requests…</UI>{" "}
        matches the title, the requester&rsquo;s name, or a reference like <UI>REQ-14</UI>, and{" "}
        <UI>Assigned to me</UI> narrows the list to yours. Click a title to open the request&rsquo;s page:
        the whole description, the audience, the requester, and every action.
      </P>
      <P>
        The <UI>Intake</UI> button in the header shows a count: for admins and managers, the requests
        waiting to be triaged; for everyone else, the open requests assigned to them.
      </P>

      <H3>Who can do what</H3>
      <P>
        Every member can see the queue and every request. Deciding is for admins and managers, and the
        person a request is assigned to can do the groundwork on it.
      </P>
      <Table
        head={["", "Admins & managers", "Assigned member", "Other members"]}
        rows={[
          ["See requests", "Yes", "Yes", "Yes"],
          ["See the requester\u2019s email", "Yes", "No", "No"],
          ["Score impact and effort", "Yes", "Yes", "No"],
          ["Talk to the requester, add notes", "Yes", "Yes", "No"],
          ["Copy or reset the status page link", "Yes", "Yes", "No"],
          ["Assign", "Yes", "No", "No"],
          ["Approve, reject, reopen", "Yes", "No", "No"],
        ]}
      />

      <H2>Scoring and assigning</H2>
      <P>
        Triage is two quick decisions per request: how much it matters and what it&rsquo;ll take. You
        can do both right on the queue row, or on the detail page.
      </P>

      <DefList>
        <Def term="Impact">
          Rate the value of doing this work from <strong>1 to 5</strong>. Higher means it moves the
          needle more &mdash; more learners reached, bigger risk retired, clearer business outcome.
        </Def>
        <Def term="Effort">
          Rate the cost to deliver it from <strong>1 to 5</strong>. Higher means more work &mdash;
          more content to build, more stakeholders to wrangle, more unknowns.
        </Def>
        <Def term="Assigned to">
          Hand the request to a workspace member with the <UI>Assign to</UI> dropdown, or leave it{" "}
          <UI>Unassigned</UI>. Assigning gives it an owner while it&rsquo;s still just a request: they&rsquo;re
          emailed a link (unless they assigned it to themselves, or <UI>Assignments</UI> emails are off in{" "}
          <UI>Settings → Notifications</UI>), it shows under <UI>My intake requests</UI> in their My Work,
          and they can score it and ask the requester questions.
        </Def>
      </DefList>

      <P>
        The moment a request has both scores, Tavoro derives its priority and an impact/effort{" "}
        <em>quadrant</em> badge &mdash; a <em>Quick win</em> (high impact, low effort), a{" "}
        <em>Big bet</em> (high impact, high effort), a <em>Fill-in</em>, or a <em>Reconsider</em>{" "}
        &mdash; so you can see at a glance what deserves your team&rsquo;s time. Scoring an untriaged
        request also moves it from <UI>Submitted</UI> to <UI>Triaging</UI> automatically.
      </P>

      <Callout tone="tip">
        You don&rsquo;t have to score everything before doing anything. The queue keeps unscored
        requests up top precisely so triage is the fast first pass &mdash; skim, score, and let the
        priority order tell you what to open next.
      </Callout>

      <H2>The request lifecycle</H2>
      <P>
        A request moves through a small, honest set of statuses. Every one is visible on the request,
        so nobody has to wonder where their ask went.
      </P>

      <DefList>
        <Def term="Submitted">
          Fresh in from the public form and not yet touched. These sit at the top of the queue.
        </Def>
        <Def term="Triaging">
          You&rsquo;ve started scoring it. A working state &mdash; it has an impact and effort read
          but no final decision.
        </Def>
        <Def term="Needs info">
          Someone asked the requester a question and is waiting for the answer. It stays on the Open tab
          but out of the header count, since the next move is the requester&rsquo;s.
        </Def>
        <Def term="Converted">
          Approved and turned into a real project. The request links straight to it.
        </Def>
        <Def term="Rejected">
          Declined, with a reason captured for the record and for the requester. An admin or manager
          can reopen it.
        </Def>
      </DefList>

      <H2>The requester&rsquo;s status page</H2>
      <Screenshot name="intake-status" alt="A requester's status page: the request title, a three-step progress bar, what they asked for, and the conversation with a reply box" caption="What the requester sees: progress, their request, and the conversation." />
      <P>
        Every request has its own private page for the person who sent it. The link is on the
        &ldquo;thanks&rdquo; screen after they submit, in their confirmation email, and in every email you send
        them. No account is needed: the link itself is the key, so it&rsquo;s long and unguessable.
      </P>
      <DefList>
        <Def term="What they see">
          Their request as they sent it, where it stands (<em>Submitted</em>, <em>Under review</em> or{" "}
          <em>Waiting on you</em>, then <em>Approved</em> or <em>Not going ahead</em> with your reason), and
          the conversation.
        </Def>
        <Def term="What they never see">
          Internal notes, scores, who it&rsquo;s assigned to, or the project it became.
        </Def>
        <Def term="Replying">
          They can reply on the page at any time. Their reply appears in the request&rsquo;s conversation, and
          the person it&rsquo;s assigned to (or, if nobody, the workspace&rsquo;s admins and managers) gets an
          email. If the request was waiting on them, it goes back to triage by itself.
        </Def>
      </DefList>
      <P>
        Admins, managers and the assigned member see <UI>Copy link</UI>, <UI>View as requester</UI> and{" "}
        <UI>Reset…</UI> under the requester&rsquo;s name. Reset makes a new link and stops the old one, for when
        a link has been forwarded somewhere it shouldn&rsquo;t be; send the new one to the requester yourself.
      </P>

      <H2>Talking to the requester</H2>
      <Screenshot name="intake-request" alt="A request's page with the conversation: a question to the requester and an internal note, above a box for writing a reply or note" caption="The conversation on a request: a question to the requester, and an internal note." />
      <P>
        Requests often arrive thin: no audience, no sense of what success looks like. Rather than guess, ask.
        The <UI>Conversation</UI> on the request&rsquo;s page holds two kinds of message:
      </P>
      <DefList>
        <Def term="Send to requester">
          Emailed to the requester and shown on their status page. The email&rsquo;s reply address is yours, so
          an answer by email reaches you rather than a no-reply inbox.
        </Def>
        <Def term="Add internal note">
          For the team only: context, a phone call&rsquo;s outcome, a pasted email answer. Notes show with a lock
          and a dashed border, and never reach the requester.
        </Def>
      </DefList>
      <P>
        Tick <UI>It&rsquo;s a question</UI> before sending to mark the request <UI>Needs info</UI>. It waits there
        until the requester replies on their page, which puts it back in triage. If they answer by email or
        phone instead, add their answer as a note and choose <UI>Back to triage without an answer</UI>.
      </P>

      <H2>Approving and rejecting</H2>
      <Screenshot name="intake-approve" alt="The Approve and create a project dialog, with the project name and a methodology choice of ADDIE, SAM or Custom" caption="Approving: name the project and pick its methodology." />
      <P>
        When a request is worth doing, use <UI>Approve &amp; create project</UI> on its page (or{" "}
        <UI>Approve</UI> on the queue row). Name the project (it starts as the request&rsquo;s title) and
        pick a methodology: <UI>ADDIE</UI>, <UI>SAM</UI>, or <UI>Custom</UI> with no phases yet. The new
        project starts with what the requester told you:
      </P>
      <DefList>
        <Def term="Description">
          The request&rsquo;s description, its audience and needed-by date, and who asked (for example{" "}
          <em>Requested by Dana Lee (REQ-14)</em>). Edit it freely afterwards.
        </Def>
        <Def term="Milestone">
          When the request had a needed-by date, a milestone on that date called{" "}
          <em>Needed by &lt;requester&gt;</em>.
        </Def>
        <Def term="Link back">
          A <UI>From REQ-14</UI> tag beside the methodology on the project, which opens the request.
        </Def>
      </DefList>
      <P>
        The request becomes <UI>Converted</UI>, records who approved it and when, and you land on the new
        project to start planning.
      </P>
      <P>
        When a request isn&rsquo;t a fit, choose <UI>Reject…</UI>, add a short reason (optional, but
        kind; it&rsquo;s emailed to the requester), and <UI>Confirm reject</UI>. The request records the
        reason, who rejected it and when. If it was a mistake, or things change, an admin or manager can{" "}
        <UI>Reopen</UI> it: it goes back to the queue without emailing the requester, who hears again when
        it&rsquo;s decided. A converted request can&rsquo;t be reopened; its project carries the work.
      </P>

      <Callout tone="note" title="Emails go out automatically">
        The requester always gets a confirmation email the moment they submit, a decision email when you
        approve or reject, and every reply you send them, each with a link to their status page &mdash; those
        are transactional and can&rsquo;t be switched off.
        Workspace admins can also get a heads-up email on each new request; that one respects the{" "}
        <UI>Intake</UI> toggle in <UI>Settings → Notifications</UI>. See the Notifications article for
        the full picture.
      </Callout>

      <H3>How Intake fits</H3>
      <P>
        Intake is the top of the funnel: it&rsquo;s where demand enters, gets weighed, and turns into
        committed work. Approved requests flow directly
        into <em>Projects</em>, where their methodology carries them from analysis through
        evaluation. Think of Intake as deciding <em>whether</em> and <em>what</em>, and Projects as
        running the <em>how</em>.
      </P>
    </>
  );
}
