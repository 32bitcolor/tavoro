import { Lead, H2, P, UL, LI, Callout, DefList, Def, UI } from "@/components/help/prose";

export default function Reports() {
  return (
    <>
      <Lead>
        <strong>Reports</strong> show how work is flowing through your team &mdash; how quickly
        requests get a decision, how much the team finishes, whether milestones land on time, and
        where the hours go. They&rsquo;re for <strong>admins and managers</strong>: open{" "}
        <UI>Reports</UI> in the sidebar (members don&rsquo;t see it).
      </Lead>

      <P>
        Pick a report with the <UI>Intake</UI>, <UI>Delivery</UI> and <UI>Time</UI> tabs, and a
        window with <UI>30 days</UI>, <UI>90 days</UI>, <UI>6 months</UI> or <UI>12 months</UI>. Short
        windows chart by week, longer ones by month. Hover or tab to a bar for its exact value, or
        open <UI>Show as table</UI> under a chart for every number at once. Reports name
        individual people, so treat them like any other team data.
      </P>

      <H2>Intake</H2>
      <DefList>
        <Def term="Requests submitted">New requests on your intake form in the window.</Def>
        <Def term="Time to decision">
          The median time from a request arriving to it being approved or rejected, for requests
          decided in the window.
        </Def>
        <Def term="Approval rate">Approved requests as a share of everything decided.</Def>
        <Def term="Waiting now">
          Requests still Submitted, Triaging or Needs info &mdash; listed oldest first under{" "}
          <UI>Waiting for a decision</UI>, so the ones that have sat longest are at the top.
        </Def>
      </DefList>

      <H2>Delivery</H2>
      <DefList>
        <Def term="Cards completed">
          Cards that reached a done status (such as <UI>Done</UI>) during the window. Moving a card
          back out of it un-completes it.
        </Def>
        <Def term="Cycle time">The median time from a card being created to it being done.</Def>
        <Def term="Milestones on time">
          Of the milestones due in the window, how many were marked complete by the end of their
          due day. The ones that weren&rsquo;t are listed under <UI>Milestones that slipped</UI>.
        </Def>
        <Def term="By person">
          Each person&rsquo;s completed, in-progress, open and overdue cards. A card with several
          assignees counts for each of them. For the cards themselves, see <UI>Team</UI>.
        </Def>
      </DefList>
      <Callout tone="note" title="Faded bars">
        Tavoro started recording exactly when cards are finished when Reports arrived. For work
        finished before then, it uses the card&rsquo;s last edit as an estimate, and draws those
        bars faded.
      </Callout>

      <H2>Time</H2>
      <P>
        The Time report is built from the <UI>Time tracking</UI> section of each project, so it
        stays empty until your team logs time.
      </P>
      <UL>
        <LI>Hours logged per week or month, by project and by person.</LI>
        <LI>
          <strong>Typical effort by deliverable type</strong> &mdash; the median and average hours
          spent on finished deliverables of each type (storyboards, videos, assessments&hellip;),
          across all time, not just the window. Log time against a deliverable to feed it; it&rsquo;s
          the number to reach for when estimating new work.
        </LI>
      </UL>
    </>
  );
}
