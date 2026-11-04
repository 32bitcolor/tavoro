import { Lead, H2, P, UL, LI, Callout, DefList, Def, Steps, UI } from "@/components/help/prose";

export default function Content() {
  return (
    <>
      <Lead>
        <strong>Content</strong> is your team&rsquo;s inventory of what&rsquo;s live: the courses,
        job aids, videos and documents you&rsquo;ve shipped. Give each one a review date or an expiry
        date, and Tavoro tells you before it goes stale, instead of finding out when a learner
        spots the out-of-date policy.
      </Lead>

      <P>
        Content lives on its own, not inside a project. Projects finish and get deleted; the
        compliance course they produced still has to be reviewed every year. When content came
        from a project, the item remembers which one, and it stays in the inventory even if that
        project is later deleted.
      </P>

      <H2>Add content</H2>
      <Steps>
        <>
          Open <UI>Content</UI> in the sidebar and choose <UI>New content</UI>. Give it a title and
          a type (<UI>Course</UI>, <UI>Job aid</UI>, <UI>Video</UI>, <UI>Assessment</UI>,{" "}
          <UI>Document</UI> or <UI>Other</UI>).
        </>
        <>
          On its page, set the <UI>Owner</UI> (whoever answers for it now that it&rsquo;s live),
          paste the link to <UI>Where it lives</UI>, and fill in the dates.
        </>
        <>Choose <UI>Save changes</UI>.</>
      </Steps>
      <P>
        Finished something in a project? On the project page, a deliverable whose status is{" "}
        <UI>Complete</UI> has a <UI>Track in Content</UI> button. It adds the deliverable to the
        inventory with its name, type and project filled in, published today and owned by you.
        Once tracked, the button becomes <UI>In Content</UI> and opens its record.
      </P>

      <H2>Dates and reviews</H2>
      <DefList>
        <Def term="Published">When it went live. For your records; nothing depends on it.</Def>
        <Def term="Next review">When someone should next check it&rsquo;s still accurate.</Def>
        <Def term="Review every">
          The review cadence: 3, 6, 12 or 24 months. <UI>Mark reviewed</UI> uses it to set the next
          review date.
        </Def>
        <Def term="Expires">The date it must no longer be in use, such as the end of a certification year.</Def>
      </DefList>
      <P>
        When you&rsquo;ve checked an item and it&rsquo;s still right, choose <UI>Mark reviewed</UI>.
        Tavoro records the date and moves the next review one cadence ahead (12 months if no cadence
        is set). If it was marked <UI>Needs review</UI>, it goes back to <UI>Published</UI>.
      </P>

      <H2>What the badges mean</H2>
      <P>Each item shows the most urgent thing about it:</P>
      <DefList>
        <Def term="Expired">The expiry date has passed. Replace or retire it.</Def>
        <Def term="Review overdue">The review date has passed.</Def>
        <Def term="Expiring soon">It expires within 30 days.</Def>
        <Def term="Review due soon">Its review is due within 30 days.</Def>
        <Def term="Needs review">
          Someone set its status to <UI>Needs review</UI>, for example because a policy it covers
          just changed.
        </Def>
        <Def term="Current">It has dates and none of them need attention yet.</Def>
        <Def term="No dates set">Nothing will remind you about it. Add a review or expiry date.</Def>
      </DefList>
      <P>
        The four tiles at the top of the <UI>Content</UI> page count the items in the most urgent
        states; select one to filter the list to it. The list is sorted most urgent first, and you
        can filter by lifecycle, type, status, owner and label, or search by title and notes.
        Filters are kept in the address, so you can share a filtered view.
      </P>

      <H2>Reminders</H2>
      <P>Tavoro emails ahead of each date, once per step:</P>
      <UL>
        <LI>Reviews: 30 days before, 7 days before, and on the day.</LI>
        <LI>Expiry: 60, 30 and 7 days before, and on the day.</LI>
      </UL>
      <P>
        Reminders go to the item&rsquo;s owner, or to the workspace&rsquo;s admins and managers if it
        has none (or its owner has left). Changing a date starts its reminders over. Drafts and
        retired items get no reminders, and an overdue item isn&rsquo;t emailed every day; it shows
        on the inventory, on the dashboard and on its owner&rsquo;s <UI>My Work</UI> page until
        someone acts. Admins can switch these emails off under{" "}
        <UI>Settings → Notifications → Content reviews &amp; expiry</UI>.
      </P>

      <H2>Retiring and deleting</H2>
      <P>
        When content is no longer in use, choose <UI>Retire</UI>. It leaves the default list (choose{" "}
        <UI>All, incl. retired</UI> in the status filter to see it), stops reminding, and keeps its
        record, so &ldquo;did we ever ship a course on this?&rdquo; still has an answer.{" "}
        <UI>Restore</UI> brings it back.
      </P>
      <Callout tone="note">
        Anyone in the workspace can add and edit content. Only admins and managers can delete an
        item, because deleting loses its history; retiring is usually what you want.
      </Callout>

      <H2>Elsewhere in Tavoro</H2>
      <UL>
        <LI>
          <UI>My Work</UI> lists the content you own that&rsquo;s due for review, expiring or
          overdue.
        </LI>
        <LI>The dashboard&rsquo;s <UI>Content health</UI> panel counts what needs attention.</LI>
        <LI>Search (<UI>Ctrl K</UI>) finds content by title, retired items included.</LI>
        <LI>
          AI assistants connected over MCP can list, update and mark content reviewed, and track a
          deliverable.
        </LI>
        <LI>Workspace backups include the inventory.</LI>
      </UL>
    </>
  );
}
