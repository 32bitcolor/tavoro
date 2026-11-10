import Link from "next/link";
import { Lead, H2, H3, P, UL, LI, Steps, Callout, DefList, Def, UI, Screenshot } from "@/components/help/prose";

export default function Storyboards() {
  return (
    <>
      <Lead>
        A <strong>storyboard</strong> is your screen-by-screen blueprint for a course — the plan a
        SME reviews and a developer builds from, before anyone opens an authoring tool. Each screen
        captures its type plus the on-screen text, narration, and the visual, interaction, and
        developer notes that spell out exactly what to build.
      </Lead>

      <H2>Create a storyboard</H2>
      <P>
        Storyboards live under <UI>Storyboards</UI> in the sidebar. You can create one on its own, or
        generate one already linked to a project deliverable (see below).
      </P>

      <Steps>
        <>
          Choose <UI>New storyboard</UI> on the <UI>Storyboards</UI> page (or <UI>New → Storyboard</UI>
          in the header), type a name in <UI>Storyboard title…</UI>, and choose <UI>Create</UI>.
        </>
        <>
          Open it, then set the <UI>Status</UI> — <UI>Draft</UI>, <UI>In review</UI>, or{" "}
          <UI>Approved</UI> — and add a description to frame the course.
        </>
        <>
          Build it out screen by screen (below). Rename the storyboard anytime by clicking its title;{" "}
          <UI>Delete storyboard</UI> removes it and its screens.
        </>
      </Steps>

      <P>
        To start from a storyboard you&rsquo;ve built before, pick it under <UI>Start from</UI> in the same dialog. Any
        storyboard can be saved as one with <UI>Save as template</UI> at the bottom of its page (see{" "}
        <Link href="/help/templates" className="underline underline-offset-2">
          Templates
        </Link>
        ).
      </P>

      <Callout tone="note">
        The storyboard <UI>Status</UI> tracks its overall state, and each card in the storyboards grid
        shows its status and screen count — a quick read on what&rsquo;s still in draft versus ready
        for a SME.
      </Callout>

      <H2>Screens</H2>
      <Screenshot name="storyboard" alt="A storyboard: the outline of screens on the left, the selected screen as a lesson page in the middle, and team notes on the right" caption="The outline, the screen as learners will read it, and the team's notes." />
      <P>
        A storyboard works like a light version of a course editor. The <UI>Outline</UI> on the left lists the screens
        in order; click one to open it in the middle as a lesson page, written the way learners will read it. The team&rsquo;s
        notes for that screen sit on the right.
      </P>
      <UL>
        <LI>
          <strong>Add</strong>: <UI>Add screen</UI> under the outline adds one at the end; <UI>Screen after this</UI> under
          the page adds one right after the current screen. Type its title straight away.
        </LI>
        <LI>
          <strong>Write</strong>: type the title at the top of the page, then the on-screen text below it. Select text to
          get the formatting bar: bold, italic, heading, subheading, lists and a callout.
        </LI>
        <LI>
          <strong>Move around</strong>: click a screen in the outline, or use <UI>Previous</UI> and <UI>Next</UI>. The address
          keeps the open screen, so a link or a reload lands on it.
        </LI>
        <LI>
          <strong>Reorder</strong>: drag a screen by its handle in the outline (it appears when you point at the screen).
        </LI>
        <LI>
          <strong>Delete</strong>: the bin icon at the top of the page (you&rsquo;ll be asked to confirm).
        </LI>
        <LI>
          <strong>Preview</strong>: shows every screen&rsquo;s on-screen text, one after another, the way learners would
          read it, without the team notes. Esc closes it.
        </LI>
      </UL>
      <P>Everything saves automatically as you go.</P>

      <H3>Screen type</H3>
      <P>
        The type picker at the top of each screen (its icon also shows in the outline) labels its role in the course flow, so the whole sequence
        reads as a lesson at a glance:
      </P>
      <DefList>
        <Def term="Intro">Sets up the course or module — objectives, agenda, welcome.</Def>
        <Def term="Content">The core teaching screens carrying the substance.</Def>
        <Def term="Video">A video segment or demonstration.</Def>
        <Def term="Knowledge check">A quick, low-stakes check for understanding.</Def>
        <Def term="Interaction">A click-to-reveal, drag-and-drop, scenario, or other activity.</Def>
        <Def term="Assessment">A graded or formal check of mastery.</Def>
        <Def term="Summary">Wrap-up, recap, and next steps.</Def>
      </DefList>

      <H3>What learners see, and the team&rsquo;s notes</H3>
      <P>
        Each screen holds five pieces of writing. The <strong>on-screen text</strong> is the page in the middle. The other
        four are <UI>Team notes</UI> on the right, for the people building and reviewing the course; learners never see
        them. An empty note shows as a small button (like <UI>+ Narration</UI>): click it to start writing.
      </P>
      <DefList>
        <Def term="On-screen text">Exactly what the learner will read on the screen.</Def>
        <Def term="Narration / VO">The voiceover or audio script for the screen.</Def>
        <Def term="Visual &amp; media notes">
          The imagery, graphics, layout, and media direction — what it should look like.
        </Def>
        <Def term="Interaction &amp; branching">
          How the learner interacts and where the course goes next — clicks, drags, branches, logic.
        </Def>
        <Def term="Developer notes">
          Build instructions for whoever assembles it in the authoring tool.
        </Def>
      </DefList>

      <H3>Which objectives a screen teaches</H3>
      <P>
        On a storyboard linked to a project, <UI>Teaches</UI> at the top of the team notes lists the project&rsquo;s
        learning objectives: click the ones this screen covers. That feeds the project&rsquo;s alignment view, so
        you can see which objectives are taught and assessed, and which aren&rsquo;t yet. See{" "}
        <em>Objectives &amp; alignment</em>.
      </P>

      <Callout tone="tip">
        Keep <strong>On-screen text</strong> and <strong>Narration</strong> distinct — reviewers read
        them differently, and separating them makes SME feedback far cleaner than one blended
        &ldquo;script.&rdquo;
      </Callout>

      <H2>Linking a storyboard to a project</H2>
      <P>
        Storyboards are strongest when tied to the project they serve. On a project&rsquo;s{" "}
        <UI>Storyboard</UI>-type deliverable, click <UI>Create storyboard</UI> to generate one already
        linked to that deliverable; afterward the button reads <UI>Open storyboard</UI>. A linked
        storyboard shows its project and deliverable at the top of the page, and routes through that
        deliverable&rsquo;s SME review cycles.
      </P>
      <P>
        You can still create standalone storyboards from the <UI>Storyboards</UI> page for early
        exploration — they simply won&rsquo;t show a project link until you build one through a
        deliverable.
      </P>

      <H2>Turn it into a course</H2>
      <P>
        When CourseForge is connected (<UI>Settings → Connected apps</UI>), <UI>Create course</UI> at the top of a storyboard
        makes a first-draft course there, owned by you:
      </P>
      <UL>
        <LI>Each screen becomes a lesson, built from its on-screen text: headings, paragraphs, lists and bold or italic text carry over. A knowledge-check screen joins the lesson before it.</LI>
        <LI>To get a real question, write it ending in &ldquo;?&rdquo;, then a bulleted list of answers, with <code>[x]</code> before the right ones and <code>[ ]</code> before the others.</LI>
        <LI>Narration, visual, interaction and developer notes, the screen&rsquo;s objectives, and the project&rsquo;s assessment items become build notes: comments on each lesson in CourseForge, to resolve as you build. Learners never see them.</LI>
        <LI>The project&rsquo;s objectives go on the course&rsquo;s cover, and the deliverable&rsquo;s card is linked to the course if it doesn&rsquo;t have one.</LI>
      </UL>
      <P>
        It&rsquo;s a one-time copy: later edits to the storyboard don&rsquo;t reach the course. <UI>Create again…</UI> makes another
        course and leaves the first as it is. The first time, open CourseForge once from <UI>Apps</UI> in the sidebar so it knows who you are.
      </P>

      <H2>Export</H2>
      <P>
        <UI>Export</UI> at the top of a storyboard gives you a <strong>Word document</strong> (to edit or
        send) or a <strong>PDF</strong> (a print view: choose <UI>Save as PDF</UI> in the print dialog),
        screen by screen with every field that has content. To export a storyboard together with an
        SME&rsquo;s comments, use <UI>Export</UI> on the review round instead.
      </P>

      <H2>Whiteboards on a storyboard</H2>
      <P>
        Every storyboard has a <UI>Whiteboards</UI> section for the loose, visual thinking that
        precedes tidy screens — sketching a course flow, roughing out a wireframe, or mapping a
        branching scenario. Click <UI>New whiteboard</UI> to create an Excalidraw canvas linked to the
        storyboard; it appears as a card you can open anytime.
      </P>

      <Callout tone="note" title="Access">
        Storyboards are visible to all workspace members by default. An admin can restrict one to
        specific groups in <UI>Settings → Groups</UI>, and access is enforced everywhere — the list,
        the dashboard, and direct links alike. Admins and managers always see every storyboard.
      </Callout>
    </>
  );
}
