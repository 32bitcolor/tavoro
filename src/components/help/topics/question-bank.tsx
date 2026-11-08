import { Lead, H2, P, UL, LI, Callout, DefList, Def, Steps, UI, Screenshot } from "@/components/help/prose";

export default function QuestionBank() {
  return (
    <>
      <Lead>
        The <strong>question bank</strong> holds the question stems and scenario patterns your team
        keeps rewriting: the privacy-breach scenario, the five-moments-of-hand-hygiene check, the
        &ldquo;what do you do first?&rdquo; question every compliance course needs. Write one once,
        then copy it into any project&rsquo;s assessment items.
      </Lead>

      <P>
        The bank stores the question, its type and level, and notes for the next designer. It
        isn&rsquo;t an exam builder: you still build the finished assessment in your authoring tool.
        It belongs to the whole workspace, so everyone can find and reuse every item.
      </P>

      <Screenshot
        name="question-bank"
        alt="The Question bank page: filters for kind, item type, level, label, use and archived, and a list of questions and scenarios with their type, level, labels and how many times each has been used"
        caption="The question bank."
      />

      <H2>Add to the bank</H2>
      <Steps>
        <>
          Open <UI>Question bank</UI> in the sidebar and choose <UI>New item</UI>. Write the
          question or scenario (up to 500 characters) and say whether it&rsquo;s a{" "}
          <UI>Question</UI> or a <UI>Scenario</UI>.
        </>
        <>On its page, set the rest and choose <UI>Save changes</UI>.</>
      </Steps>
      <DefList>
        <Def term="Item type">
          What it becomes in a project: <UI>Multiple choice</UI>, <UI>True/false</UI>,{" "}
          <UI>Short answer</UI>, <UI>Scenario</UI> or <UI>Other</UI>.
        </Def>
        <Def term="Level">The Bloom level it assesses, matching the levels on learning objectives.</Def>
        <Def term="Notes">
          The answer and why, the distractors, the policy it comes from. Notes stay in the bank;
          they aren&rsquo;t copied into projects.
        </Def>
        <Def term="Labels">The workspace&rsquo;s labels, so you can filter the bank by topic.</Def>
      </DefList>
      <P>
        Already wrote a good question on a project? Under <UI>Assessment items</UI>, choose{" "}
        <UI>Save to bank</UI> on it. The bank entry takes its wording and type, and its level when
        the objectives it assesses share one.
      </P>

      <H2>Use a bank item in a project</H2>
      <P>
        On a project, under <UI>Assessment items</UI>, choose <UI>Add from the question bank</UI>{" "}
        and pick one. Or, from a bank item&rsquo;s page, choose <UI>Copy into a project</UI>. Either
        way, the project gets its own assessment item marked <UI>From bank</UI>; link it to the
        project&rsquo;s objectives as usual.
      </P>
      <Callout tone="note">
        A copy is independent. Rewording the bank entry never changes a course that&rsquo;s already
        shipped, and tailoring the copy for one project never changes the bank.
      </Callout>

      <Screenshot
        name="bank-item"
        alt="A bank item's page: the scenario text, its kind, item type and level, notes with the answer and source, labels, and the start of its Used in list"
        caption="A scenario in the bank, and the projects that reuse it."
      />

      <H2>See where an item is used</H2>
      <P>
        A bank item&rsquo;s <UI>Used in</UI> list shows every project holding a copy. Copies in
        projects you can&rsquo;t open are counted but not named. When a policy changes, this is how
        you find every course whose questions need another look. Filter the bank by{" "}
        <UI>Not used in any project</UI> to find what nobody has picked up.
      </P>

      <H2>Archiving and deleting</H2>
      <P>
        Choose <UI>Archive</UI> to stop an item being offered for reuse. It leaves the default view
        and the <UI>Add from the question bank</UI> list, but its record and its <UI>Used in</UI>{" "}
        list stay. <UI>Restore</UI> brings it back. Deleting removes it for good; copies in projects
        stay but no longer say where they came from. Only the person who added an item, or an admin
        or manager, can delete it.
      </P>

      <H2>Elsewhere in Tavoro</H2>
      <UL>
        <LI>Search (<UI>Ctrl K</UI>) finds bank items by their wording.</LI>
        <LI>Project templates remember which assessment items came from the bank.</LI>
        <LI>
          AI assistants connected over MCP can search the bank, add and edit items, copy them into
          projects, and save a project&rsquo;s assessment items to the bank.
        </LI>
        <LI>Workspace backups include the bank.</LI>
      </UL>
    </>
  );
}
