import { Lead, H2, H3, P, Steps, Callout, DefList, Def, UI, Screenshot } from "@/components/help/prose";

export default function Notifications() {
  return (
    <>
      <Lead>
        Tavoro keeps people in the loop by email — a card assigned to you, a comment on work
        you&rsquo;re an SME on, a review someone asked you to do. The guiding rule is simple: you&rsquo;re
        never emailed about your own actions, so notifications stay signal, not noise.
      </Lead>

      <H2>The one rule that shapes everything</H2>
      <P>
        Every notification is about something <em>someone else</em> did that affects <em>you</em>. If you
        move a card, complete your own subtask, or comment on a thread, Tavoro won&rsquo;t email you about
        it — the person who took the action is skipped, and only the other people who care get the message.
        That keeps your inbox honest: an email means something changed that you didn&rsquo;t already know
        about.
      </P>

      <Callout tone="note">
        Notifications are opt-out, not opt-in. Every type is on unless an admin turns it off, so new kinds
        of activity reach people automatically without anyone having to go enable them first.
      </Callout>

      <H2>What sends an email</H2>
      <P>
        There are eight categories of notification. Each one can be switched on or off for the whole
        workspace under <UI>Settings → Notifications</UI> (see below) — but by default, they all send.
      </P>

      <DefList>
        <Def term="Assignments">
          When someone is assigned to a card, subtask or intake request, or named as an SME.
        </Def>
        <Def term="Status changes">
          When a card moves to a new status, or a subtask is completed or reopened.
        </Def>
        <Def term="Comments">
          New comments on a card you&rsquo;re assigned to or an SME on.
        </Def>
        <Def term="Mentions">
          When you&rsquo;re @-mentioned in a comment or a card description.
        </Def>
        <Def term="Reviews">
          Review requests, and decisions on reviews you requested.
        </Def>
        <Def term="Intake requests">
          New stakeholder requests land in an admin&rsquo;s inbox, and a requester&rsquo;s reply on their status
          page goes to whoever the request is assigned to (or, if nobody, the admins and managers).
        </Def>
        <Def term="Member accounts">
          Welcome emails for new members and password-reset notices.
        </Def>
        <Def term="Due-date reminders">
          A nudge the day before something is due: cards (to their assignees), milestones (to admins),
          and reviews not yet decided (to the reviewer, guests included).
        </Def>
        <Def term="Content reviews & expiry">
          Ahead of a tracked content item&rsquo;s review date (30 and 7 days before, and on the day) and
          expiry date (60, 30 and 7 days before, and on the day), to its owner, or to admins and managers
          when it has none. See the Content inventory help topic.
        </Def>
      </DefList>

      <P>
        Notice how the audience is always the people connected to the work: a status change reaches the
        card&rsquo;s assignees and SMEs, a comment reaches the same circle, a review decision goes back to
        whoever requested it. Tavoro figures out who to tell so you don&rsquo;t have to cc anyone.
      </P>

      <H2>Every email links straight back</H2>
      <P>
        No notification asks you to go hunting. Each one ends with a <UI>View in Tavoro</UI> button that
        deep-links to exactly the thing it&rsquo;s about — the specific card, the review, the project, or
        the intake request — so you land on the right screen in one click.
      </P>

      <Callout tone="tip">
        Emails to external stakeholders who can&rsquo;t sign in (for example, an intake requester confirming
        their submission) skip the button, since there&rsquo;s nothing for them to open. Everyone with a
        workspace account gets the link. When someone asks an intake requester a question, the email&rsquo;s
        reply address is the asker&rsquo;s own, so the answer reaches a person rather than a no-reply inbox.
      </Callout>

      <H2>@-mentions in comments and descriptions</H2>
      <P>
        Sometimes you need a specific person, not just whoever&rsquo;s already on the card. Mentions handle
        that. In a card&rsquo;s comment thread or its rich-text description, type <UI>@</UI> and a picker
        appears — start typing a name or email to narrow it, then pick the member. When you post, that
        person gets a <strong>Mentions</strong> email with an excerpt and a link back to the card.
      </P>

      <Steps>
        <>
          Open a card and click into the <UI>Comments</UI> box (or the <UI>Description</UI> field).
        </>
        <>
          Type <UI>@</UI> followed by a few letters of the person&rsquo;s name or email, then choose them
          from the list.
        </>
        <>
          Finish your note and post it. The mentioned person is emailed with the surrounding text and a
          link straight to the card.
        </>
      </Steps>

      <Callout tone="note" title="Who you can mention">
        The picker only lists members who can actually access that board and card. You can&rsquo;t mention
        someone into work they aren&rsquo;t allowed to see — if a board is restricted to certain groups,
        only those people (and admins) show up.
      </Callout>

      <P>
        Comments are rich text, so a mention sits inline alongside bold, italic, links, and lists. Mention
        as many people as a note calls for; each one gets their own email.
      </P>

      <H2>Admin controls: Settings → Notifications</H2>
      <Screenshot name="notifications-settings" alt="Settings, Notifications: the SMTP status, a test email form, and a toggle for each type of email" caption="Settings → Notifications." />
      <P>
        Admins tune the whole system from one screen. It&rsquo;s admin-only — regular members don&rsquo;t
        see it, and there are no per-person preferences to manage. Everything here applies to the entire
        workspace.
      </P>

      <H3>Turning types on and off</H3>
      <P>
        Under <UI>What sends an email</UI>, each of the eight types has a toggle. Flip one off and Tavoro
        stops sending that category to <em>everyone</em>; flip it back on to resume. Changes save instantly
        — there&rsquo;s no separate save button — so you can quiet a chatty category the moment it becomes a
        distraction.
      </P>

      <Callout tone="warning">
        These toggles are workspace-wide, not personal. Turning off <UI>Status changes</UI> silences status
        emails for the whole team, not just for you. Use them to set the overall tone of what Tavoro emails
        about.
      </Callout>

      <H3>The SMTP status indicator</H3>
      <P>
        At the top of the panel, <UI>Status</UI> shows whether outbound email is working. When the server has
        an email provider configured, you&rsquo;ll see <UI>SMTP configured</UI>. Until then it reads{" "}
        <UI>Not configured</UI> — and while it does, <strong>nothing sends at all</strong>, no matter how the
        toggles are set.
      </P>

      <H3>Send a test email</H3>
      <P>
        Before you trust delivery, prove it. Enter a recipient and click <UI>Send test email</UI> to fire a
        message immediately. If the provider rejects it — an unverified sending domain, a bad credential —
        the exact error appears right there, so you can fix the setup instead of guessing. The button is
        disabled until SMTP is configured.
      </P>

      <H2>How delivery is set up</H2>
      <P>
        Tavoro sends through your workspace&rsquo;s own SMTP provider. Whoever runs your server sets the{" "}
        <UI>SMTP_*</UI> environment variables — host, credentials, and the address mail goes out from — and
        restarts the app. Once those are in place, the status flips to <UI>SMTP configured</UI> and
        notifications start flowing. There&rsquo;s nothing to configure inside the app beyond the toggles;
        the connection itself lives in the server environment.
      </P>

      <Callout tone="note" title="Nothing sends until SMTP is wired up">
        If no SMTP host is set, Tavoro quietly sends nothing rather than failing loudly. If people say
        they&rsquo;re not getting emails, an admin should check the status indicator first and send a test.
      </Callout>

      <H2>Due-date reminders</H2>
      <P>
        Reminders are the one type that isn&rsquo;t triggered by someone&rsquo;s action — they run on a
        schedule. A background worker checks each day and, the day before a card or a project milestone is
        due, emails the people responsible so a deadline doesn&rsquo;t sneak up. Like every other type, it
        respects the <UI>Due-date reminders</UI> toggle and only sends when SMTP is configured.
      </P>
    </>
  );
}
