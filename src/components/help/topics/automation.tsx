import { Lead, H2, H3, P, UL, LI, Steps, Callout, DefList, Def, UI } from "@/components/help/prose";

const Q = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;

export default function Automation() {
  return (
    <>
      <Lead>
        Automation rules do routine card work for the team: <em>when</em> something happens to a card,{" "}
        <em>if</em> the card matches a query, <em>then</em> change it or tell someone. Admins manage them
        in <UI>Settings → Automation</UI>.
      </Lead>

      <H2>Make a rule</H2>
      <Steps>
        <>
          Click <UI>New rule</UI>, name it, and choose whether it applies to every board or one.
        </>
        <>
          Pick what starts it (<strong>When</strong>).
        </>
        <>
          Optionally narrow it with a condition (<strong>If</strong>) &mdash; the same query language as
          the Cards page, like <Q>priority &gt;= high AND labels = qa</Q>. <UI>Check</UI> shows how many
          cards match now.
        </>
        <>
          Add up to ten actions (<strong>Then</strong>), and <UI>Save rule</UI>. Tavoro checks the
          statuses, labels, fields and people it names exist before saving.
        </>
      </Steps>

      <H2>When</H2>
      <DefList>
        <Def term="A card is created">Including cards made by MCP and templates; not cards brought in by a Jira import.</Def>
        <Def term="A card's status changes">Optionally only to one status &mdash; &ldquo;to Done&rdquo;.</Def>
        <Def term="A field changes">Assignee, priority, labels, due date, type, estimate, sprint, epic, or a custom field.</Def>
        <Def term="Someone comments">Any new comment on the card.</Def>
        <Def term="All of a card's subtasks are done">When the last open subtask is ticked off.</Def>
        <Def term="A due date is coming up">Checked every day at 07:00 UTC: cards due in exactly N days (0 = today) that aren&rsquo;t done.</Def>
        <Def term="On a schedule">Every day, or every Monday, at 07:00 UTC, for every card that matches the condition (a condition is required; at most 200 cards a run).</Def>
      </DefList>

      <H2>Then</H2>
      <UL>
        <LI>move it to a status (its board needs a column for that status)</LI>
        <LI>assign or unassign someone, add a watcher</LI>
        <LI>set the priority, the due date (N days from the day it runs), or a custom field</LI>
        <LI>add or remove a label</LI>
        <LI>add a comment (shown as from the rule) or a subtask</LI>
        <LI>email its assignees, its watchers, or a person, with your message and a link to the card</LI>
      </UL>

      <H3>Examples</H3>
      <UL>
        <LI>When the status changes to <em>In review</em>, if <Q>sme is not EMPTY</Q>: add the label <em>needs SME</em>.</LI>
        <LI>When all subtasks are done: move it to <em>In review</em>.</LI>
        <LI>When a due date is 2 days away, if <Q>assignee is EMPTY</Q>: email Maya &ldquo;Nobody&rsquo;s on this yet&rdquo;.</LI>
        <LI>Every Monday, if <Q>status = Backlog AND updated &lt; -30d</Q>: add the label <em>stale</em>.</LI>
      </UL>

      <H2>What you&rsquo;ll see</H2>
      <P>
        Rules run in the background a moment after the change. Each card&rsquo;s History shows what a
        rule did, as <em>Automation · rule name</em>. Each rule keeps a log of its last 200 runs &mdash;
        open it under the rule &mdash; with any problem spelled out, such as a status that was renamed.
        Turn a rule off with its <UI>On</UI> switch.
      </P>
      <Callout tone="note" title="Rules and email">
        A rule&rsquo;s changes don&rsquo;t send the usual notifications (an assignment by a rule
        doesn&rsquo;t email the assignee); use the <UI>Email people</UI> action when someone should
        know.
      </Callout>
      <Callout tone="tip" title="Rules that trigger rules">
        A rule&rsquo;s changes can start other rules &mdash; up to three in a chain, and at most ten
        rule runs on one card per minute. Past that, the run log says it stopped, so two rules can&rsquo;t
        loop forever.
      </Callout>
    </>
  );
}
