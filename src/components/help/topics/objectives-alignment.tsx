import Link from "next/link";
import { Lead, H2, H3, P, UL, LI, Steps, Callout, DefList, Def, UI, Screenshot } from "@/components/help/prose";

export default function ObjectivesAlignment() {
  return (
    <>
      <Lead>
        Learning objectives are the spine of good design — they say what a learner should be able to
        <em> do</em>, and everything else (content, assessment) should line up behind them. Tavoro
        makes that alignment a first-class, checkable thing instead of a spreadsheet you keep in your
        head.
      </Lead>

      <H2>What makes a good objective</H2>
      <P>
        A strong objective is <strong>observable and measurable</strong> — it uses a verb you can
        actually see or score. &ldquo;Understand phishing&rdquo; isn&rsquo;t testable;
        &ldquo;identify three signs of a phishing email&rdquo; is. Tavoro tags each objective with a
        level from <strong>Bloom&rsquo;s Revised Taxonomy</strong> and suggests strong verbs for that
        level, to nudge you away from fuzzy ones like &ldquo;know&rdquo; or &ldquo;understand.&rdquo;
      </P>
      <DefList>
        <Def term="Remember">Recall facts — define, list, identify, name.</Def>
        <Def term="Understand">Explain ideas — summarize, describe, classify, compare.</Def>
        <Def term="Apply">Use it in a new situation — demonstrate, solve, execute.</Def>
        <Def term="Analyze">Draw connections — differentiate, organize, diagnose.</Def>
        <Def term="Evaluate">Justify a stand — critique, assess, recommend.</Def>
        <Def term="Create">Produce something new — design, construct, develop.</Def>
      </DefList>

      <H2>The alignment spine</H2>
      <P>
        Once objectives exist, two things attach to them — and Tavoro shows you the gaps:
      </P>
      <UL>
        <LI>
          <strong>Content teaches them.</strong> On any storyboard screen, tag the objectives that
          screen teaches. Each objective then shows how many screens cover it (and warns if
          it&rsquo;s <UI>Not yet taught</UI>).
        </LI>
        <LI>
          <strong>Assessment measures them.</strong> Add assessment items to the project and link
          each to the objectives it checks. Each objective shows how many items assess it (and warns
          if it&rsquo;s <UI>Not yet assessed</UI>).
        </LI>
      </UL>
      <Callout tone="note">
        The assessment side is a lightweight <strong>question bank</strong>, not an exam engine —
        Tavoro tracks what you&rsquo;re measuring and how it aligns, while the actual quiz lives in
        your authoring tool or LMS.
      </Callout>

      <H2>How to use it</H2>
      <Screenshot name="alignment" alt="The Learning objectives & alignment section: each objective with its Bloom level and how many screens teach it and items assess it" caption="Each objective shows its Bloom level and its taught and assessed coverage." />
      <Steps>
        <>
          Open a project and find <strong>Learning objectives &amp; alignment</strong>. Add
          objectives — one per thing a learner should be able to do — and set each one&rsquo;s Bloom
          level.
        </>
        <>
          In the project&rsquo;s storyboards, expand a screen and use the <UI>Teaches</UI> chips
          (O1, O2, …) to mark which objectives that screen covers.
        </>
        <>
          Back on the project, add <strong>assessment items</strong> and toggle which objectives each
          one <UI>Assesses:</UI>. Reuse a question with <UI>Add from the question bank</UI>, or share
          a good one with <UI>Save to bank</UI> (see{" "}
          <Link href="/help/question-bank" className="font-medium text-accent underline underline-offset-2">
            Question bank
          </Link>
          ).
        </>
        <>
          Read the coverage summary at the top: any objective flagged <UI>Not yet taught</UI> or{" "}
          <UI>Not yet assessed</UI> — and any screens that teach nothing — are your gaps to close.
        </>
      </Steps>

      <H3>Why it&rsquo;s worth it</H3>
      <P>
        This is the check that catches the expensive mistakes early: an objective nobody assesses, a
        screen that doesn&rsquo;t map to any objective, an assessment that tests something you never
        taught. Fixing those on the alignment view is a lot cheaper than finding them in review.
      </P>

      <Callout tone="tip">
        Objectives live on the project and drive its phases too — pair this with the{" "}
        <Link href="/help/addie-sam" className="font-medium text-accent underline underline-offset-2">
          ADDIE &amp; SAM
        </Link>{" "}
        flow: write objectives in Analyze/Preparation, teach them in Design/Develop, and prove them in
        Evaluate.
      </Callout>
    </>
  );
}
