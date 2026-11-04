import { Lead, H2, P, UL, LI, Callout, DefList, Def, Steps, UI, Screenshot } from "@/components/help/prose";

export default function Templates() {
  return (
    <>
      <Lead>
        A <strong>template</strong> is a project or storyboard you can start from again. Save the annual compliance refresh
        once, with its phases, deliverables, storyboard and boards, and next year&rsquo;s refresh starts there instead of from
        a blank page.
      </Lead>

      <Screenshot
        name="templates"
        alt="The Templates page: project and storyboard templates, each with what it contains, who saved it, and a Use template button"
        caption="Templates: every reusable skeleton in the workspace."
      />

      <H2>Save a template</H2>
      <Steps>
        <>Open the project or storyboard you&rsquo;d like to reuse.</>
        <>
          At the bottom of its page, choose <UI>Save as template</UI>.
        </>
        <>
          Name it, say what it&rsquo;s for, and choose <UI>Save template</UI>.
        </>
      </Steps>
      <P>
        The template is a copy: later changes to the project or storyboard don&rsquo;t change it, and deleting the project
        doesn&rsquo;t delete it. To update a template, make your changes in a project, choose <UI>Save as template</UI>{" "}
        again and pick <UI>Replace &ldquo;…&rdquo;</UI>.
      </P>

      <H2>What&rsquo;s copied</H2>
      <DefList>
        <Def term="Project templates">
          The methodology and description; the phases, with their dates; milestones; deliverables and their phases; the
          storyboard of each storyboard deliverable, screen by screen; learning objectives, assessment items and how they
          align; and the project&rsquo;s boards, with their columns and cards (title, description, labels and subtasks), all
          starting in the board&rsquo;s first to-do column.
        </Def>
        <Def term="Storyboard templates">Every screen, with its type and all its text: on-screen text, narration, visuals, interaction and developer notes.</Def>
        <Def term="Not copied">
          Anything that belongs to one particular run: statuses (everything starts <UI>Not started</UI>), assignees, SMEs,
          owners, comments, review rounds and files, time entries, attachments, card due dates and sprints. A storyboard
          template also leaves out objective links, because objectives belong to a project.
        </Def>
      </DefList>

      <H2>Start from a template</H2>
      <P>
        Choose <UI>New project</UI> or <UI>New storyboard</UI> and pick the template under <UI>Start from</UI>, or choose{" "}
        <UI>Use template</UI> on the <UI>Templates</UI> page. For a project you also pick a <UI>Start date</UI>: phase and
        milestone dates keep their spacing from the template and move to start on that day. A phase that began two weeks
        in still begins two weeks in.
      </P>

      <H2>Managing templates</H2>
      <P>
        The <UI>Templates</UI> page (linked from the top of <UI>Projects</UI> and <UI>Storyboards</UI>) lists every
        template with what it contains and who saved it.
      </P>
      <UL>
        <LI>Anyone in the workspace can use templates and save new ones.</LI>
        <LI>Whoever saved a template, and admins and managers, can rename, replace or delete it.</LI>
        <LI>Deleting a template doesn&rsquo;t touch the projects or storyboards already made from it.</LI>
      </UL>
      <Callout tone="note">
        Templates are visible to the whole workspace, even when the project or storyboard they came from is restricted to
        some groups. Check what&rsquo;s in it before you save one from a confidential project.
      </Callout>

      <H2>Elsewhere in Tavoro</H2>
      <UL>
        <LI>AI assistants connected over MCP can list templates, start a project or storyboard from one, and save new ones.</LI>
        <LI>Workspace backups include templates.</LI>
      </UL>
    </>
  );
}
