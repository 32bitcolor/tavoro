# Tavoro — the operating system for instructional-design teams

A self-hosted workspace that runs the whole instructional-design workflow in one place:
intake the request, plan the project, design the learning, get SMEs to sign off, keep the team
moving in sprints, and align every objective to content and assessment. It **sits above the
authoring tools and LMS you already use** instead of trying to replace them.

Built for instructional designers, learning-experience designers, eLearning developers, and
L&D / enablement teams. Runs on your own server (a Proxmox VM is the documented path).

> **Status:** the ID workflow layer is live. That covers:
> - multi-user workspaces with group-based access
> - Kanban boards with a list view and a side-panel card editor
> - ADDIE/SAM project management and team sprints
> - storyboards and Excalidraw whiteboards
> - a stakeholder intake queue
> - an objectives → content → assessment alignment spine
> - email notifications
> - an **MCP server**, so Claude and other AI assistants can read and work in a workspace
>
> SME review is now **review links**:
> - rounds frozen at the moment they start
> - comments pinned to storyboard text, PDF pages and images
> - guest links for reviewers without an account
> - an every-reviewer-approves gate with an admin override
> - comments sent to a board as cards, and rounds exported to Word or PDF
>
> Still to come: content lifecycle and reuse, and LMS integration
> (see **[The vision](#the-vision)**).

## Why Tavoro

Instructional designers live in a fragmented toolchain:
- authoring tools (Storyline, Rise, Captivate)
- a generic project-management tool
- design docs in Word or Slides
- assets scattered across Drive
- an LMS

There's **no single source of truth**, and switching between them all costs real time. Generic project tools don't speak
"learning"; authoring tools don't do process, collaboration, or governance. Tavoro fills that
gap: the connective tissue that makes an ID team run.

The under-served needs it's built for:

- **SME review and approval**: the #1 daily bottleneck. Feedback arrives scattered across email
  and marked-up PDFs, with no version control and no deadlines.
  → **Review rounds**, where SMEs comment directly on the storyboard text or on the PDF/image
  you exported. Outside SMEs get a personal link, no account needed, and every round shows
  what changed since the last one.
- **Intake and demand management**: turn L&D from a reactive order-taker into a strategic partner.
  → A public **intake form** feeding a triage → impact/effort scoring → approve-to-project pipeline.
- **Objectives → content → assessment alignment**: the ID's core craft, today tracked in
  spreadsheets or nowhere.
  → A first-class **alignment spine** threading objectives through storyboard screens and
  assessment items, with coverage and gap views.
- **Content lifecycle and reuse**: know what's going stale and what depends on what, and stop
  rebuilding the same templates and scenarios. *(On the roadmap.)*
- **Proving impact**: move past completion rates toward real outcome data. *(On the roadmap, via
  LMS integration.)*

## Where it fits

Tavoro is deliberately **not** an authoring tool and **not** an LMS. It sits *above* them as the
system of record and collaboration hub. You keep building courses in Storyline, Rise or Captivate
and delivering them in your LMS; Tavoro runs the work around them. Eventually it will also
publish to the LMS and pull completion and impact data back.

The same line applies to review: Tavoro shows what it can render safely, never running anything
uploaded. That means storyboards, PDFs and images. For an eLearning build, publish it to PDF and
review that.

## What's built today

- **App shell**: a collapsible sidebar, breadcrumbs, and global search with a `⌘K` command palette.
  - A **+ New** menu, plus header shortcuts to **My Work** and **Intake** with counts.
  - Instant switching between **17 built-in themes**, all on one shadcn/ui design system.
- **Workspaces, members and groups**:
  - three per-workspace roles (**ADMIN / MANAGER / MEMBER**) and email/password sign-in
  - admins add members, reset passwords, change roles and organize people into groups
  - everyone manages their own password and theme in **Settings → Account**
- **Group-based access control**: boards, projects, storyboards and whiteboards are open to all
  members by default, but can be restricted to specific groups. Admins and managers always keep
  access. It's enforced everywhere, including lists, search, the dashboard and direct links, not
  just hidden in the UI.
- **Intake**: a shareable public request form (per workspace, can be switched off) feeding a
  triage queue. Score requests by **impact and effort**, assign an owner, then **approve and
  convert to a project** or reject with a reason. Requesters are emailed automatically.
- **Boards**: Kanban with drag-and-drop, plus a **list view**. Each board has its own **card
  keys** (`SEC-7`, with short links), and filters by label, assignee and due date can be saved as
  personal **views**. Cards open in a **side panel**, so you keep the board in sight:
  - press `J`/`K` to step between cards
  - a rich-text description with @-mentions
  - status, sprint, due date, **assignees and SMEs**, and workspace-wide **labels**
  - subtasks, comments, file attachments and linked whiteboards

  Boards that belong to a project show a strip with the current phase, the next milestone and
  alignment coverage.

  A board can be **shared publicly** as a read-only link for people without an account. Cards
  marked **Private** are left off it, and so are comments, attachments, SMEs, reviews and email
  addresses. Admins see every shared board, and can switch links off, in **Settings → Sharing**.
- **Projects**: ADDIE, SAM or custom methodologies.
  - phases with status, dates and a progress bar
  - deliverables linked to board cards and storyboards, each with its review rounds
  - milestones, time tracking, and optional sprint planning
- **Review rounds** (SME review and approval):
  - **Starting a round** freezes the storyboard as it is, or reviews a **PDF or image** you upload,
    up to 95 MB. A Storyline or Rise export works well.
  - **Reviewers** are workspace members and/or **guests**. Each guest gets a personal, expiring
    link (no account needed) to a page that shows just that one round.
  - **Commenting:** reviewers select storyboard text to quote it. On a PDF or image they drop
    numbered pins, mark areas, or select PDF text to quote it. Threads can be resolved or marked
    *won't fix*, with a note the reviewer sees.
  - **Decisions:** Approve, **Approve with minor changes**, or Request changes. A round passes only
    when **every reviewer approves**. Admins and managers can override, with a recorded reason.
  - **Round 2 onwards** shows what changed since the last round, screen by screen.
  - **For designers:** guest links can be copied, re-sent, reset or turned off. Reviewers get
    reminders the day before a review is due, and the requester is emailed each decision with a
    comment count.
  - **Feedback becomes work:** send comments to a board as cards (one each, or one card with a
    subtask per comment) that quote the comment and link back to it. **All feedback** shows every
    comment from every round, grouped by screen or page, for bulk resolving or sending. A finished
    card offers to resolve the comments it came from.
  - **Export** a round, with each comment beside the field or page it's about, to **Word** or
    **PDF**. Storyboards export the same way.
- **Sprints**: workspace-wide, time-boxed iterations (planned → active → completed) with a goal and
  dates. A **team sprint board** pulls cards from every board into one view, grouped by status,
  with the same filters and saved views.
- **Alignment spine**: write measurable **learning objectives** on a project and connect them to
  storyboard **screens** and **assessment items**. Coverage and gap analysis shows what's untaught
  or unassessed.
- **Storyboards**: screen-by-screen course design. Each screen has a type, rich-text fields
  (on-screen text, narration, visual, interaction and developer notes) and the objectives it
  teaches. Storyboards can be linked to a project deliverable, and export to Word or PDF.
- **Whiteboards**: Excalidraw canvases for workflows, wireframes and ideas. They autosave, and can
  be linked to a storyboard or started from a board card.
- **My Work**: everything waiting on you.
  - reviews awaiting your decision, which you can decide right there
  - reviews you've requested, your assigned cards and subtasks, and upcoming milestones
  - a **Review History** tab
- **Email notifications** for:
  - assignments, status changes and comments
  - @-mentions
  - review requests, guest invites and decisions
  - intake, and account changes
  - day-before due-date reminders

  Every email links back into the app. Admins can turn each category on or off in
  **Settings → Notifications**.
- **Dashboard**: active projects with phase progress, reviews awaiting you, and upcoming milestones.
- **Workspace admin**:
  - **backup and restore**, including attachments and review files
  - workspace **labels**
  - a one-click **self-update** (pull, rebuild, migrate) from **Settings → Updates**
- **Single sign-on and provisioning**: connect a SAML 2.0 identity provider (tested with JumpCloud) so
  people sign in with their work account, provision and deactivate members over SCIM 2.0, and give
  Tavoro roles from the provider's groups. Deactivated members are suspended, and their work stays.
  ([docs/SSO.md](docs/SSO.md))
- **AI assistants over MCP**: Tavoro is a Model Context Protocol server at `/api/mcp`.
  - Claude.ai, Claude Desktop and ChatGPT connect from just the URL. They sign in through OAuth, and
    you pick the workspace and read-only or read-and-change access.
  - Claude Code, Codex, Cursor, VS Code, Gemini CLI and other tools connect the same way, or with a
    personal token.
  - 50 tools cover search and fetch (whole items as Markdown documents, the shape ChatGPT's deep
    research reads), My Work, boards and cards, projects, storyboards, review rounds, intake and
    sprints, with rich text as Markdown. There are also resources for each project, board, storyboard,
    card and round, and prompts for status reports, review-feedback summaries, storyboard drafts,
    intake triage and sprint planning.
  - Assistants act as you, see only what you can see, and can be disconnected any time in
    **Settings → AI & MCP**.
- **In-app Help**: a guide library (getting started, ADDIE and SAM, objectives and alignment, and a
  walkthrough of every module) built with the same design system. The same guides are in
  [docs/help](docs/help/README.md) as Markdown, generated from the app with `npm run help:export`
  (`npm run help:check` fails if they're out of date). Their screenshots live in `public/help-shots`
  and are retaken from a demo-seeded workspace with `npm run help:screenshots`.

## Screenshots

All captured from a live instance with demo data.

**Dashboard**: active projects with phase progress, reviews awaiting you, and upcoming milestones.

![Dashboard](docs/screenshots/dashboard.png)

**Boards**: Kanban with card keys, labels, due dates, people, and a project context strip (phase,
next milestone, alignment).

![Kanban board](docs/screenshots/board.png)

**Card panel**: cards open beside the board. Press `J`/`K` to step through them.

![Card side panel](docs/screenshots/card-panel.png)

**List view**: the same board as a table, grouped by column.

![Board list view](docs/screenshots/board-list.png)

**Projects**: methodology, status, phases, boards, and the alignment spine on one page.

![Project](docs/screenshots/project.png)

**Review rounds**: the storyboard as it was when the round started, filtered to what changed
since round 1, with quoted comments and a guest reviewer alongside a member.

![Storyboard review round](docs/screenshots/review-storyboard.png)

**Reviewing a PDF**: a Storyline export, with a numbered comment quoting text selected on the page.

![PDF review](docs/screenshots/review-pdf.png)

**Guest view**: what an outside SME sees from their link. No account, no app chrome, just the
round.

![Guest review page](docs/screenshots/review-guest.png)

**All feedback**: every comment from every round, grouped by screen, ready to resolve in bulk or
send to the board. The comment marked SEC-28 is already a card.

![All feedback for a deliverable](docs/screenshots/review-feedback.png)

**Export**: a round as Word or PDF, with each comment and its replies under the field it's about.

![Review round export](docs/screenshots/review-export.png)

**My Work**: everything waiting on you, with decisions right there.

![My Work](docs/screenshots/my-work.png)

**Sprints**: the team sprint board, pulling cards from every board into one iteration.

![Sprint board](docs/screenshots/sprint-board.png)

**Intake**: stakeholder requests, scored by impact and effort and converted into projects.

![Intake queue](docs/screenshots/intake.png)

**Storyboards**: screen-by-screen design, with the objectives each screen teaches.

![Storyboard](docs/screenshots/storyboard.png)

**Whiteboards**: Excalidraw canvases, optionally linked to a storyboard.

![Whiteboard](docs/screenshots/whiteboard.png)

**17 built-in themes**: the whole UI re-themes instantly. Here's the board in three of them:

| Dracula | Nord | Solarized Light |
| :-----: | :--: | :-------------: |
| ![Dracula](docs/screenshots/theme-dracula.png) | ![Nord](docs/screenshots/theme-nord.png) | ![Solarized Light](docs/screenshots/theme-solarized.png) |

**On a phone**: every page fits a phone screen, guest review included.

| Dashboard | Guest review |
| :-------: | :----------: |
| <img src="docs/screenshots/mobile-dashboard.png" alt="Mobile dashboard" width="300"> | <img src="docs/screenshots/mobile-review.png" alt="Guest review on a phone" width="300"> |

## The vision

Tavoro aims to be the operating system for an instructional-design team: one place for the work
around a course, from the first request to proof that it worked. It's built around five pillars.
Three are live; two are next.

1. **Intake and demand management** ✅: structured request capture, triage, impact/effort scoring,
   and approve-to-project conversion.
2. **SME review and approval** ✅: review rounds on frozen storyboards, PDFs and images, with
   anchored comments, guest links, an every-reviewer gate, email notifications, comments sent to
   the board as cards, and Word/PDF export. Still planned: reviewing videos and reporting SME
   turnaround times. See [docs/REVIEW-LINKS.md](docs/REVIEW-LINKS.md).
3. **Objectives → content → assessment alignment spine** ✅: objectives threaded through storyboard
   screens and assessment items, with coverage and gap analysis.
4. **Content lifecycle and a reusable asset library** (next): a content inventory with review and
   expiry dates, impact analysis when a source changes, and a searchable library of templates,
   scenarios and question banks. A first design, grounded in the current schema, is on the
   [`content-lifecycle-design`](https://github.com/32bitcolor/tavoro/blob/content-lifecycle-design/docs/CONTENT-LIFECYCLE-REUSE.md)
   branch.
5. **LMS integration** (next): publish and sync courses to your LMS, and pull completion and
   assessment data back for impact reporting.

Underneath the pillars, Tavoro is meant to fit how a company already runs, not ask it to change:

- **People come from your identity provider.** Members sign in with their work account over SAML,
  are provisioned and deactivated over SCIM, and get their Tavoro role from their groups
  ([docs/SSO.md](docs/SSO.md)). Live, and tested with JumpCloud; guides for other providers will
  follow as each is tested.
- **AI assistants work in it as you.** Over MCP, the assistant someone already uses (Claude,
  ChatGPT, Cursor and others) can read and update the workspace with exactly that person's access
  ([docs/MCP.md](docs/MCP.md)). Live.
- **It stays yours.** Self-hosted, with backups, restore and updates from the admin settings.

> **On scope:** a standalone exam builder and a course-authoring module were both removed as
> off-strategy. Building courses and grading assessments is the job of the authoring tools and
> the LMS. Assessment lives on in Tavoro as part of the alignment spine, not as a bespoke exam
> engine. A built-in chat assistant was also tried and removed: it would have needed its own AI
> account for every member, while MCP lets people bring the assistant they already pay for.

## Tech stack

| Layer         | Choice |
| ------------- | ------ |
| Framework     | Next.js 16.4 (App Router, React 19.2): UI, route handlers and Server Actions |
| Language      | TypeScript end to end |
| UI            | shadcn/ui + Tailwind CSS v4, with theme tokens driving 17 themes |
| Rich text     | TipTap 3 (descriptions, comments and storyboard fields, with @-mentions), stored as JSON and converted to and from Markdown for MCP and exports |
| Whiteboards   | Excalidraw |
| PDF review    | pdf.js 6, drawing pages to canvas with a selectable text layer (no scripts, no forms) |
| Exports       | Word files written directly as WordprocessingML (zipped with fflate), no template or Office dependency |
| Database      | PostgreSQL 16 + Prisma 7 (`@prisma/adapter-pg` driver adapter) |
| Auth          | Email/password with argon2 (`@node-rs/argon2`), signed-JWT sessions (`jose`) and a Data Access Layer; per-workspace roles. Guest reviewers use separate HMAC-signed links, not accounts |
| SSO           | SAML 2.0 service provider on `@node-saml/node-saml` (signature, audience, time and InResponseTo checks), IdP metadata parsed with `@xmldom/xmldom` + `xpath`; a SCIM 2.0 server for Users and Groups with hashed bearer tokens |
| MCP           | `@modelcontextprotocol/sdk`, Streamable HTTP (stateless). Clients sign in with OAuth 2.1 (PKCE, client metadata documents, dynamic registration) or use personal tokens |
| Validation    | Zod 4 |
| Background    | BullMQ + Redis worker: queued email (nodemailer), daily due-date reminders, and a nightly clean-up of unused review files and stale MCP credentials. Redis also holds rate limits, pending SAML request ids and the assertion replay guard |
| Object store  | S3-compatible (MinIO) via the AWS SDK. Uploads and downloads stream through the app (large files as multipart uploads, with HTTP Range for PDFs), so MinIO never needs to be public |
| Ordering      | Fractional indexing for drag-and-drop positions |
| Reverse proxy | Caddy (automatic HTTPS) |
| Packaging     | Docker Compose (Postgres, Redis, MinIO, migrate, app, worker, Caddy) |
| Tooling       | ESLint; Playwright for end-to-end checks and screenshots (README and Help); `tsx` scripts that export the in-app Help to Markdown |

### A note on auth

Tavoro owns its sign-in rather than building on NextAuth/Auth.js. It uses the lightweight
**`jose` session + Data Access Layer** pattern from the official Next.js 16 docs: a signed,
http-only session cookie, and one server-only layer (`lib/dal.ts`) that every page, action and
route goes through to learn who's asking and what they can reach. When this was built, NextAuth v5
was still in beta and predated Next 16's async request APIs and Proxy (formerly middleware), and we
didn't want the foundation to depend on unproven compatibility. Keeping it small also made the
later additions straightforward, because each one plugs into the same session and the same checks.

- **Single sign-on** is an additional way to start that same session, not a second auth system.
  node-saml verifies the identity provider's response (a signed response or assertion; never
  neither), each assertion is accepted only once, and the session records that it began with SSO.
  A workspace can **require SSO**: its members can't use a password there, though admins can, as the
  break-glass if the provider is down.
- **Provisioning never deletes work.** A SCIM deactivation or delete *suspends* the membership. The
  Data Access Layer checks suspension on every request, so a suspended member loses access at once,
  their API tokens are revoked, and their cards, comments and reviews stay.
- **AI assistants** (MCP) sign in with OAuth or a personal token. Either one resolves to a person and
  a workspace, and then goes through the same authorization as the app, so an assistant can never
  see more than its person can. See [docs/MCP.md](docs/MCP.md).
- **Guest reviewers** are deliberately **not** users. A link is `<guestId>.<HMAC(SESSION_SECRET, …)>`,
  exchanged on first visit for a cookie scoped to that one review page. Nothing in the member
  authorization layer can return a guest, and a database dump alone can't forge a link.

## Project layout

```
src/
  app/
    (auth)/login, (auth)/signup    Sign-in and sign-up
    (auth)/oauth/authorize         OAuth consent for MCP clients
    request/[slug]                 Public intake form
    review/                        Guest review pages (no app shell): /review/<token> swaps the
                                   link for a cookie → /review/g/<guestId>, plus its file route
    (app)/                         Signed-in modules, all behind one shared shell:
      layout.tsx                   Auth gate + sidebar + header/breadcrumbs
      dashboard, my-work, intake, boards, projects, sprints,
      storyboards, whiteboards, team, help
      reviews/[roundId]            A review round (members)
      c/[key]                      Card short-link resolver (e.g. /c/SEC-7)
      settings/                    Account and AI & MCP (everyone) + Members, Groups, Intake, Labels,
                                   Notifications, Backup, Updates (admins)
    api/                           search (⌘K), attachments, review-files (streamed upload +
                                   ranged download), workspace backup/restore, mcp (the MCP
                                   server), oauth/* (metadata, register, token, revoke)
    actions/                       Server Actions, one file per domain (boards, cards, projects,
                                   reviews, review-guest, sprints, storyboards, intake, …)
  components/
    app-shell/                     Sidebar, breadcrumbs, command palette, quick-create, badges
    board/ project/ sprint/        Feature components (incl. the TipTap editors + mentions)
    review/                        Review round view, PDF/image review, reviewer list
    storyboard/ whiteboard/ intake/ my-work/ team/ settings/ help/
    shared/ ui/                    Shared building blocks + shadcn/ui primitives
  lib/
    modules.ts        Module registry: feeds the sidebar, breadcrumbs and dashboard
    dal.ts / db.ts    Data Access Layer and the Prisma client (server-only)
    authz.ts          Resource authorization + group-based access
    review-*.ts       Review rounds: anchors, snapshots/diffs, outcomes, comments, files,
                      guest links and sessions, and the nightly file sweep
    storage.ts        MinIO access (streamed uploads, ranged reads)
    mcp/              MCP server: tools by area, resources, prompts (docs/MCP.md)
    principal.ts / api-tokens.ts / oauth.ts   Who an MCP request acts as; tokens; OAuth helpers
    markdown.ts / rich-text.ts   TipTap JSON ⇄ Markdown, and the block model exports use
    notifications.ts / notify.ts / email-templates.ts / mailer.ts / queues.ts / reminders.ts
    workspace-backup.ts   Workspace export/import
    status.ts / sprint.ts / methodology.ts / storyboard.ts / saved-views.ts   Domain vocabularies
  generated/prisma    Generated Prisma client (gitignored)
prisma/
  schema.prisma       Data model
  migrations/         SQL migrations (applied by the migrate service / `prisma migrate deploy`)
  seed.ts             Idempotent first-admin seed (*-demo-seed.ts: optional demo content)
worker/index.ts       BullMQ worker: email, reminders, review-file sweep (LMS sync lands here)
scripts/              Build helpers (copies pdf.js assets into public/vendor)
deploy/               Caddyfile + the host self-update agent
docs/                 Deployment guide, design docs, screenshots
Dockerfile            Multi-stage: deps → build → migrate / app / worker
docker-compose.yml
```

## Local development

Prerequisites: Node.js 22 (20.9+ works) and Docker or Podman.

```bash
# 1. Install dependencies
npm install

# 2. Create your env, then point it at local services:
#    S3_ENDPOINT=http://localhost:9000 (the default, minio:9000, only resolves inside Compose)
cp .env.example .env

# 3. Start Postgres and MinIO from Compose, plus a local Redis
#    (Compose keeps its Redis private, so run one for development)
docker compose up -d postgres minio
docker run -d --name tavoro-redis -p 6379:6379 redis:7-alpine

# 4. Apply the schema and seed the first admin
npm run db:migrate            # create/apply migrations
npm run db:seed               # creates admin@tavoro.local / changeme123

# 5. Run the app and (optionally) the worker
npm run dev                   # http://localhost:3000
npm run worker                # second terminal: email, reminders, file sweep
```

Sign in with the seeded admin, or, on an empty database, create the first workspace via
**Sign up** (later signups need `ALLOW_SIGNUP=true`). Email needs SMTP
(`SMTP_*`) configured and the worker running; without them everything works, it just doesn't send
mail. Guest review links also need `APP_URL` set, so the emailed links point at your server.

### Useful scripts

- `npm run build`: production build (standalone output; copies the pdf.js assets first)
- `npm run db:migrate`: create and apply a migration (dev)
- `npm run db:deploy`: apply migrations (prod / CI)
- `npm run db:seed`: seed the first admin (idempotent)
- `npm run lint`: ESLint

## Deploying

See **[docs/DEPLOY-PROXMOX.md](docs/DEPLOY-PROXMOX.md)** for the full walkthrough. In short:
1. Create an Ubuntu VM and install Docker.
2. Copy this repo and a filled-in `.env` onto it.
3. Point DNS (or an IP) at the VM.
4. Run `docker compose up -d`.

Caddy provisions HTTPS, the `migrate` service applies the schema and seeds the admin, and then the
app and worker start. Admins can pull future updates from **Settings → Updates** without touching
the shell.

## Design docs

- [docs/REVIEW-LINKS.md](docs/REVIEW-LINKS.md): review rounds, anchored comments, guest links and
  file review, with the decisions behind them and what's left.
- [docs/PROJECTS-BOARDS-REDESIGN.md](docs/PROJECTS-BOARDS-REDESIGN.md): the item-first model that
  connects projects, boards and the team sprint board.
- [docs/MCP.md](docs/MCP.md): the MCP server, covering authentication, how it reuses the app's permission
  model, and every tool, resource and prompt.
