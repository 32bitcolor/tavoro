import { Lead, H2, H3, P, UL, LI, Steps, Callout, DefList, Def, UI } from "@/components/help/prose";

export default function JiraImport() {
  return (
    <>
      <Lead>
        Moving from Jira? Admins can bring Jira Cloud projects into Tavoro as boards &mdash; issues
        with their keys, types, priorities, story points, epics, sub-tasks, sprints, links, comments,
        attachments and watchers. You see what will come over before anything is imported, and you
        can run it again later to pick up what changed in Jira.
      </Lead>

      <H2>Before you start</H2>
      <UL>
        <LI>
          You need to be a workspace <strong>admin</strong> in Tavoro, and have an Atlassian account
          that can browse the projects you want.
        </LI>
        <LI>
          Make an <strong>API token</strong> at <UI>id.atlassian.com → Security → API tokens</UI>.
          Tavoro keeps it encrypted only while the import runs and deletes it when the import ends.
        </LI>
        <LI>
          Invite your team first. People are matched to members by email (or by name when Jira hides
          the email), so the more of them are here, the more assignees, comments and watchers line up.
        </LI>
        <LI>
          Take a <UI>Backup</UI> (Settings) first if you&rsquo;re importing into a workspace that
          already has work in it.
        </LI>
      </UL>

      <H2>Run an import</H2>
      <Steps>
        <>
          Go to <UI>Settings → Import</UI>. Enter your Jira site (<em>acme.atlassian.net</em>), the
          Atlassian account&rsquo;s email and the API token, and click <UI>Connect</UI>.
        </>
        <>
          Tick the projects to import. Each becomes <UI>A new board</UI> named after the project, with
          the Jira project key as its key prefix &mdash; so <em>PROJ-123</em> stays{" "}
          <em>PROJ-123</em>. You can rename it, change the prefix, or pick an existing board instead.
        </>
        <>
          Click <UI>Scan</UI>. Tavoro reads the projects (nothing is imported yet) and shows what will
          come over: issues, sub-tasks, epics, comments, attachments, sprints, links and labels, with
          anything that won&rsquo;t.
        </>
        <>
          Check the <strong>mapping</strong>. Jira statuses are matched to your statuses by name; ones
          with no match are created in the right category. People are matched to members; anyone
          unmatched keeps their name on their comments. Issue types become Task, Story, Bug or Epic,
          and sub-tasks become subtasks. The story points field is found for you.
        </>
        <>
          Click <UI>Import</UI>. It runs in the background &mdash; you can leave the page &mdash; and
          finishes with a report and links to the new boards.
        </>
      </Steps>

      <H2>What comes over</H2>
      <DefList>
        <Def term="Issues">
          Cards with the same key, title, description (rich text converted), type, priority, status,
          due date, labels and created date. Story points become the card&rsquo;s estimate.
        </Def>
        <Def term="Epics and sub-tasks">
          Epics become epic cards with their issues in them; sub-tasks become subtasks of their card.
        </Def>
        <Def term="Sprints">
          Sprints come over with their name, goal, dates and state (future → planned, active,
          closed → completed). A card that was in several sprints goes in the latest. The Backlog
          keeps Jira&rsquo;s rank order.
        </Def>
        <Def term="Links">
          <em>Blocks</em>, <em>relates to</em>, <em>duplicates</em> and <em>clones</em> come over as
          the same links; other link types become <em>relates to</em>.
        </Def>
        <Def term="Comments and attachments">
          Comments keep their author and date. Attachments are copied into Tavoro (up to 95 MB each).
        </Def>
        <Def term="People">
          Matched assignees, comment authors and watchers come over as themselves; the reporter becomes
          a watcher. Someone who isn&rsquo;t a member shows as <em>Jane Doe (from Jira)</em> on their
          comments, and a card assigned to them comes over unassigned with a &ldquo;From Jira&rdquo;
          note. Nobody is invited or emailed.
        </Def>
        <Def term="Components and fix versions">
          Labels such as <em>component: Onboarding</em> and <em>version: 2.1</em> (you can turn this
          off in the mapping).
        </Def>
      </DefList>
      <P>
        <strong>Not imported:</strong> custom fields other than story points, worklogs, votes,
        workflows and automation, permission schemes, and change history &mdash; each card&rsquo;s
        History starts with one &ldquo;imported it from PROJ-123 on Jira&rdquo; entry instead.
      </P>

      <H2>Run it again</H2>
      <P>
        Importing the same projects again updates the cards it brought over before and adds new
        issues, comments and attachments. It never deletes anything, and it doesn&rsquo;t overwrite a
        field someone has changed in Tavoro since the last import &mdash; the report counts those as
        left alone. That lets a team import, keep working in Jira for a while, and top up before
        switching over.
      </P>

      <H3>Keys</H3>
      <P>
        If a project goes into an existing board with a different prefix, its cards get that
        board&rsquo;s keys; the report lists old and new keys, and searching for the old Jira key still
        finds the card.
      </P>

      <Callout tone="note" title="If an import stops">
        An import that fails part way keeps what it already brought over, and the report says why it
        stopped. Running it again picks up without duplicating anything. <UI>Cancel import</UI> stops
        a run the same way.
      </Callout>
    </>
  );
}
