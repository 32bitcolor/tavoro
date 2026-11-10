<!-- Generated from src/components/help by `npm run help:export`. Edit the app's help, not this file. -->

# Storyboards

> A **storyboard** is your screen-by-screen blueprint for a course — the plan a SME reviews and a developer builds from, before anyone opens an authoring tool. Each screen captures its type plus the on-screen text, narration, and the visual, interaction, and developer notes that spell out exactly what to build.

## Create a storyboard

Storyboards live under **Storyboards** in the sidebar. You can create one on its own, or generate one already linked to a project deliverable (see below).

1. Choose **New storyboard** on the **Storyboards** page (or **New → Storyboard**in the header), type a name in **Storyboard title…**, and choose **Create**.
2. Open it, then set the **Status** — **Draft**, **In review**, or **Approved** — and add a description to frame the course.
3. Build it out screen by screen (below). Rename the storyboard anytime by clicking its title; **Delete storyboard** removes it and its screens.

To start from a storyboard you’ve built before, pick it under **Start from** in the same dialog. Any storyboard can be saved as one with **Save as template** at the bottom of its page (see [Templates](templates.md)).

> **Note.** The storyboard **Status** tracks its overall state, and each card in the storyboards grid shows its status and screen count — a quick read on what’s still in draft versus ready for a SME.

## Screens

![A storyboard: the outline of screens on the left, the selected screen as a lesson page in the middle, and team notes on the right](../../public/help-shots/storyboard.png)
*The outline, the screen as learners will read it, and the team's notes.*

A storyboard works like a light version of a course editor. The **Outline** on the left lists the screens in order; click one to open it in the middle as a lesson page, written the way learners will read it. The team’s notes for that screen sit on the right.

- **Add**: **Add screen** under the outline adds one at the end; **Screen after this** under the page adds one right after the current screen. Type its title straight away.
- **Write**: type the title at the top of the page, then the on-screen text below it. Select text to get the formatting bar: bold, italic, heading, subheading, lists and a callout.
- **Move around**: click a screen in the outline, or use **Previous** and **Next**. The address keeps the open screen, so a link or a reload lands on it.
- **Reorder**: drag a screen by its handle in the outline (it appears when you point at the screen).
- **Delete**: the bin icon at the top of the page (you’ll be asked to confirm).
- **Preview**: shows every screen’s on-screen text, one after another, the way learners would read it, without the team notes. Esc closes it.

Everything saves automatically as you go.

### Screen type

The type picker at the top of each screen (its icon also shows in the outline) labels its role in the course flow, so the whole sequence reads as a lesson at a glance:

**Intro** — Sets up the course or module — objectives, agenda, welcome.

**Content** — The core teaching screens carrying the substance.

**Video** — A video segment or demonstration.

**Knowledge check** — A quick, low-stakes check for understanding.

**Interaction** — A click-to-reveal, drag-and-drop, scenario, or other activity.

**Assessment** — A graded or formal check of mastery.

**Summary** — Wrap-up, recap, and next steps.

### What learners see, and the team’s notes

Each screen holds five pieces of writing. The **on-screen text** is the page in the middle. The other four are **Team notes** on the right, for the people building and reviewing the course; learners never see them. An empty note shows as a small button (like **+ Narration**): click it to start writing.

**On-screen text** — Exactly what the learner will read on the screen.

**Narration / VO** — The voiceover or audio script for the screen.

**Visual & media notes** — The imagery, graphics, layout, and media direction — what it should look like.

**Interaction & branching** — How the learner interacts and where the course goes next — clicks, drags, branches, logic.

**Developer notes** — Build instructions for whoever assembles it in the authoring tool.

### Which objectives a screen teaches

On a storyboard linked to a project, **Teaches** at the top of the team notes lists the project’s learning objectives: click the ones this screen covers. That feeds the project’s alignment view, so you can see which objectives are taught and assessed, and which aren’t yet. See *Objectives & alignment*.

> **Tip.** Keep **On-screen text** and **Narration** distinct — reviewers read them differently, and separating them makes SME feedback far cleaner than one blended “script.”

## Linking a storyboard to a project

Storyboards are strongest when tied to the project they serve. On a project’s **Storyboard**-type deliverable, click **Create storyboard** to generate one already linked to that deliverable; afterward the button reads **Open storyboard**. A linked storyboard shows its project and deliverable at the top of the page, and routes through that deliverable’s SME review cycles.

You can still create standalone storyboards from the **Storyboards** page for early exploration — they simply won’t show a project link until you build one through a deliverable.

## Turn it into a course

When CourseForge is connected (**Settings → Connected apps**), **Create course** at the top of a storyboard makes a first-draft course there, owned by you:

- Each screen becomes a lesson, built from its on-screen text: headings, paragraphs, lists and bold or italic text carry over. A knowledge-check screen joins the lesson before it.
- To get a real question, write it ending in “?”, then a bulleted list of answers, with `[x]` before the right ones and `[ ]` before the others.
- Narration, visual, interaction and developer notes, the screen’s objectives, and the project’s assessment items become build notes: comments on each lesson in CourseForge, to resolve as you build. Learners never see them.
- The project’s objectives go on the course’s cover, and the deliverable’s card is linked to the course if it doesn’t have one.

It’s a one-time copy: later edits to the storyboard don’t reach the course. **Create again…** makes another course and leaves the first as it is. The first time, open CourseForge once from **Apps** in the sidebar so it knows who you are.

## Export

**Export** at the top of a storyboard gives you a **Word document** (to edit or send) or a **PDF** (a print view: choose **Save as PDF** in the print dialog), screen by screen with every field that has content. To export a storyboard together with an SME’s comments, use **Export** on the review round instead.

## Whiteboards on a storyboard

Every storyboard has a **Whiteboards** section for the loose, visual thinking that precedes tidy screens — sketching a course flow, roughing out a wireframe, or mapping a branching scenario. Click **New whiteboard** to create an Excalidraw canvas linked to the storyboard; it appears as a card you can open anytime.

> **Access.** Storyboards are visible to all workspace members by default. An admin can restrict one to specific groups in **Settings → Groups**, and access is enforced everywhere — the list, the dashboard, and direct links alike. Admins and managers always see every storyboard.

---

← [Sprints](sprints.md) · [All guides](README.md) · [Whiteboards](whiteboards.md) →
