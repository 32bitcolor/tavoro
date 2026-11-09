import { Lead, H2, H3, P, UL, LI, Callout, UI } from "@/components/help/prose";

const Q = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;

export default function Cards() {
  return (
    <>
      <Lead>
        <UI>Cards</UI> in the sidebar lists every card you can see, across every board, found with a
        short query. Sort the results, choose the columns, save the query for later, and change many
        cards at once.
      </Lead>

      <H2>Write a query</H2>
      <P>
        A query is one or more conditions &mdash; a field, an operator and a value &mdash; joined with{" "}
        <Q>AND</Q>, <Q>OR</Q> and <Q>NOT</Q>, with brackets where you need them. Add{" "}
        <Q>ORDER BY</Q> to sort. As you type, the bar suggests fields, operators and values from your
        workspace; press <UI>Tab</UI> or <UI>Enter</UI> to take one, and <UI>Enter</UI> to search.
      </P>
      <UL>
        <LI>
          <Q>assignee = me AND done = false</Q> &mdash; your open cards
        </LI>
        <LI>
          <Q>status = &quot;In review&quot; AND updated &lt; -7d</Q> &mdash; stuck in review for a week
        </LI>
        <LI>
          <Q>labels in (qa, video) AND priority &gt;= high ORDER BY due</Q>
        </LI>
        <LI>
          <Q>sprint = active AND blocked = true</Q> &mdash; what&rsquo;s holding the sprint up
        </LI>
        <LI>
          <Q>epic is EMPTY AND type = story</Q> &mdash; stories that belong to no epic
        </LI>
      </UL>
      <P>
        If something&rsquo;s wrong, the bar highlights the part it couldn&rsquo;t read and says why
        &mdash; an unknown status, say, with the ones that exist.
      </P>

      <H3>Fields</H3>
      <UL>
        <LI>
          <Q>text ~</Q> searches titles and descriptions; <Q>title</Q>, <Q>key</Q> (<Q>SEC-12</Q>, and
          old or Jira keys too)
        </LI>
        <LI>
          <Q>type</Q>, <Q>status</Q>, <Q>category</Q> (todo, active, done), <Q>priority</Q> (where{" "}
          <Q>&gt;</Q> means more urgent), <Q>estimate</Q>
        </LI>
        <LI>
          <Q>assignee</Q>, <Q>sme</Q> and <Q>watcher</Q> take <Q>me</Q>, a name or an email
        </LI>
        <LI>
          <Q>labels</Q>, <Q>epic</Q> (key or title), <Q>sprint</Q> (a name, or active, planned,
          completed), <Q>board</Q> (name or key prefix), <Q>project</Q>
        </LI>
        <LI>
          <Q>due</Q>, <Q>start</Q>, <Q>created</Q>, <Q>updated</Q> take a date (<Q>2026-12-01</Q>),{" "}
          <Q>today</Q>, or a distance from today: <Q>7d</Q>, <Q>-2w</Q>, <Q>1m</Q>
        </LI>
        <LI>
          <Q>blocked</Q> and <Q>done</Q> are true or false
        </LI>
      </UL>
      <P>
        Operators: <Q>=</Q> <Q>!=</Q> <Q>&gt;</Q> <Q>&gt;=</Q> <Q>&lt;</Q> <Q>&lt;=</Q>, <Q>~</Q>{" "}
        (contains), <Q>in (a, b)</Q>, <Q>not in (…)</Q>, and <Q>is EMPTY</Q> /{" "}
        <Q>is not EMPTY</Q>. Put values with spaces in quotes. As in Jira, <Q>!=</Q> leaves out cards
        with no value at all &mdash; add <Q>OR field is EMPTY</Q> to include them.
      </P>

      <H2>The results</H2>
      <P>
        Click a column header to sort by it (it rewrites the query&rsquo;s <Q>ORDER BY</Q>), choose
        what to show with <UI>Columns</UI>, and click a card to open it in the card panel. Keep a query
        &mdash; with its columns &mdash; under <UI>Views</UI> → <UI>Save current filters…</UI>; saved
        queries are personal. The page&rsquo;s address includes the query, so you can share a link.
      </P>

      <H2>Change many cards at once</H2>
      <P>
        Tick cards (or all on the page, then <UI>Select all matching</UI>, up to 1,000), then choose a
        change in the bar at the bottom: status, assign or unassign someone, priority, type, estimate,
        sprint, epic, add or remove a label, watch, move to another board, or delete. You confirm once.
      </P>
      <Callout tone="note" title="What a bulk change does">
        Each card changes exactly as if you&rsquo;d changed it on its own: the same permissions, a line
        in its History, and notifications &mdash; but everyone affected gets <strong>one email</strong>{" "}
        listing the cards, not one per card. Cards you can&rsquo;t change are listed with the reason.
      </Callout>
    </>
  );
}
