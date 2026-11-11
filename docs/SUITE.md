# Tavoro + CourseForge: a connected suite

**Decision (2026-11-09):** Tavoro and CourseForge stay two apps but work as one suite. Tavoro is
the hub: it owns people (SAML sign-in, SCIM provisioning), the work around a course (intake,
projects, storyboards, review, inventory, reports), and the links between the two. CourseForge
owns building and shipping courses (editor, player, brand kits, LMS packages, screen capture).

Why not one codebase: the apps already duplicate sign-in, review links, asset libraries, question
banks, templates, notifications and MCP, and CourseForge brings a live-collaboration server, a
size-budgeted player and a Playwright renderer. Merging is months of work that would stop both.
Each step below is useful on its own, and a later merge stays possible.

## Steps

1. **One sign-in** ✅ (this document, below). CourseForge signs people in with Tavoro; each app
   links to the other.
2. **Linking** ✅ (below). A card links to its CourseForge course and shows its live status;
   the board shows a course badge; CourseForge's editor links back to the card.
3. **Storyboard → course** ✅ (below). A storyboard becomes a CourseForge first draft; builder
   notes arrive as review comments.
4. **Reviews** ✅ (below). *Design (decided 2026-11-10): one card per review request, not per comment.*
   Creating a review link in CourseForge creates a card in Tavoro (on the linked course's board,
   linked to that course); each reviewer's comments become subtasks under that card, and resolving
   a comment completes its subtask. SME turnaround reporting then covers built courses without
   flooding boards with a card for every comment.
5. **Pillar 5 (LMS)** ✅ (below). CourseForge publishes to the LMS; Tavoro's content inventory points at the
   live package; learners' results flow back into Tavoro's reports. *CourseForge never sees the
   LMS's own records, so the results are what the course player reports, anonymously.*

## Step 1: sign in with Tavoro

An admin connects CourseForge in **Settings → Connected apps** (`/settings/apps`) and pastes the
one-time connection key into CourseForge's **Admin → Settings → Sign in with Tavoro**. The key is
`tavoro-connect:` + base64url JSON `{v:1, tavoro, client_id, client_secret}`.

### Protocol

OpenID Connect's authorization code flow, kept small (both ends are ours):

| Step | Where | What |
| --- | --- | --- |
| 1 | CourseForge `GET /auth/tavoro/start?next=` | Makes state, nonce and a PKCE verifier, keeps them in an encrypted 10-minute cookie (`cf_tavoro`, path `/auth/tavoro`), redirects to Tavoro. |
| 2 | Tavoro `GET /suite/authorize` | A page, not a route handler (see below). Checks the app and its exact redirect URI first (shown, never redirected to, if wrong), then the session (no session: `/login?next=`), then membership via `usableMembershipWhere` (so SSO-required workspaces need an SSO session). Issues a two-minute one-time code. |
| 3 | CourseForge `GET /auth/tavoro/callback` | Checks state and `iss`, then posts to Tavoro. |
| 4 | Tavoro `POST /api/suite/token` | Client secret (Basic or form) + code + `code_verifier`. Returns an `id_token`: HS256 with the client secret (OIDC Core §10.1), 5 minutes, claims `iss aud sub nonce email name role workspace{id,name}`. |
| 5 | CourseForge | Verifies the token, finds the account by `tavoroSub`, else by email (and links it), else creates one (if allowed, with the chosen role), starts a session. |

Roles (CourseForge setting **Roles follow Tavoro**, on by default): Tavoro ADMIN → CourseForge
OWNER, MANAGER/MEMBER → the configured role (Editor or Viewer), at sign-in and on every sync;
locked in CourseForge's Members while on. CourseForge never demotes or suspends its last active
owner.

Membership sync: CourseForge's scheduler calls Tavoro `GET /api/suite/members` (client secret)
every 5 minutes (`TAVORO_SYNC_MS`). Linked accounts not listed as active are suspended
(`disabledAt` + `tavoroSuspended`, sessions revoked) and restored when listed again, except the
last active owner. Names and (when on) roles follow Tavoro.

**Tavoro-only** (CourseForge setting): `/login` goes straight to Tavoro; non-owners can't use a
password. Owners can at `/login?password=1`, the way back in if Tavoro is down.

### Data

- Tavoro: `ConnectedApp` (workspace, url, clientId, secret sealed with `lib/secret-box`, last
  sign-in and sync times) and `ConnectedAppCode` (hashed one-time codes, PKCE challenge, nonce).
  Not in workspace backups (like SSO settings and AI tokens): a restored copy reconnects.
- CourseForge: `OrgSettings.tavoro*` (url, client id, sealed secret, workspace name, policy,
  sync status) and `User.tavoroSub`, `User.tavoroSuspended`.

### Gotchas

- `/suite/authorize` must be a **page**. After Tavoro's login server action, the client router
  follows the redirect to `next`; a route handler there that redirects to another origin
  leaves the browser stuck on `/login`. A page's `redirect()` to another site becomes a real
  navigation.
- `/suite/` is a public prefix in `src/proxy.ts`, so a stale link shows "Can't sign you in"
  before asking anyone to log in.
- The connection key and the token's `iss` use `APP_URL` (or the request's host when unset):
  set `APP_URL` on servers, or a key made on one hostname fails on another.
- Local test: CourseForge `apps/studio/tests/tavoro.e2e.mjs` (43 checks) with Tavoro on :3100 and CourseForge studio on
  :3300 (`PUBLIC_URL=http://localhost:3300 SCHEDULER_TICK_MS=3000 TAVORO_SYNC_MS=4000 npx next dev -p 3300`).

## Step 2: cards linked to courses

A card has at most one course (`CardCourse`, unique on `cardId`). In the card drawer, **Course**
shows the cover, title (opens CourseForge), Draft / In review / Live in LMS, lesson count, open
review comments, problems from CourseForge's Check, and who edited it when. **Link a course**
searches the courses the person can *edit* in CourseForge; **New course in CourseForge** starts a
blank one named after the card (minus a leading "Course:"), owned by them. The board card face
shows a graduation-cap badge with the course title and state. History records link, change and
unlink. MCP: `find_courses`, `link_course` (`course_id` or `create: true`), `unlink_course`;
`get_card` includes `course`.

CourseForge's editor header shows **Tavoro SAE-3** (or "N cards") linking back to the card.

### API

| Direction | Endpoint | What |
| --- | --- | --- |
| Tavoro → CF | `GET /api/suite/courses?sub=&q=` | Courses that Tavoro person can edit (picker). `404 no_account` until they've signed in to CourseForge with Tavoro once. |
| Tavoro → CF | `GET /api/suite/courses?ids=a,b[&sub=]` | Summaries; with `sub`, only those the person can edit (linking checks this, so a course id alone isn't permission). |
| Tavoro → CF | `POST /api/suite/courses {sub,title}` | New blank course (with the default brand kit) owned by that person; viewers refused. |
| CF → Tavoro | `GET /api/suite/course-links?course=` | Cards linked to a course (private cards' titles hidden). |

All with the connection's client id + secret (HTTP Basic), both ways.

Summary shape (`lib/courseforge.ts` `CourseSummary`): `id title url cover lessons micro
state(draft|review|live) openComments checks{errors,warnings} owner updatedAt deleted`. "review"
= an active review link; "live" = an active live package.

### Freshness

The summary is cached on `CardCourse`. It refreshes: when the card drawer opens (shown cached
first, then refreshed); after a board render, for stale ones (`after()`); and every 10 minutes in
the worker (`suite` queue) for anything older than `STALE_MS` (10 minutes). A course deleted in
CourseForge shows as deleted on the card; unlink it or link another.

### Keys

Settings → Connected apps → **New key** rotates the secret without touching links (paste the
new key into CourseForge straight away). **Disconnect** deletes the app and, with it, every
card's course link.

Test: CourseForge `apps/studio/tests/tavoro-courses.e2e.mjs` (25 checks; also needs the collab
server on :3200 for the editor header check).

## Step 3: storyboard → course

**Create course** on a storyboard (and MCP `create_course_from_storyboard`) sends the storyboard
as Markdown to CourseForge `POST /api/suite/storyboards {sub, storyboard}`; CourseForge
(`packages/import/src/storyboard.ts`, `storyboardToCourse`) decides what becomes what:

| Storyboard | Course |
| --- | --- |
| Storyboard title / description | Course title / cover description |
| Project objectives | "You'll be able to:" list on the cover |
| Screen | Lesson (title = screen title) |
| `knowledge_check` screen | Joins the previous lesson |
| On-screen text | Blocks, through the Markdown importer: headings (pushed two levels down so they stay inside the lesson), paragraphs, lists, notes (`> [!TIP]`), and knowledge checks (a line ending in "?" then `- [x]` / `- [ ]` items) |
| Narration, visual, interaction, developer notes; screen objectives; video / interaction / knowledge-check / assessment hints; empty screens | **Build notes**: OPEN review comments from "Storyboard", `context` = the label, anchored to the lesson's first block |
| Project assessment items (prompt, kind, objectives) | One build note on the last lesson |

Nothing written for the team becomes learner-facing content. The course uses the organisation's
default brand kit and is owned by the person. Tavoro records `Storyboard.courseAppId/courseId/
courseTitle/courseAt` and links the deliverable's card (`CardCourse`) when it has no course. It's a
one-time copy: re-running makes a new course. Build notes count as open comments on the card.

Test: CourseForge `apps/studio/tests/tavoro-storyboard.e2e.mjs` (31 checks) and
`packages/import/src/storyboard.test.ts`.

## Step 4: reviews → a card with subtasks

Creating a **review link** in CourseForge makes **one** Tavoro card; each reviewer's **comment** is a
**subtask** of it, ticked when the comment is resolved. Nothing is made per comment on the board.

CourseForge `POST /api/suite/reviews { review }` (client secret) sends a review's **whole state**
every time something changes (link created or revoked, comment added, resolved or re-opened), so
Tavoro can repeat or miss a message without drifting:

```
review: { id, title, course: { id, title, url }, createdBy (Tavoro sub), expiresAt,
          comments: [{ id, author, text, where, url, resolved }] }
```

Tavoro (`src/lib/suite-reviews.ts`) answers `{ card, subtasks: { created, updated } }`, or
`{ card: null, reason }`:

| What | Behaviour |
| --- | --- |
| Where the card goes | The board of the (earliest) card the course is linked to (`CardCourse`), in the board's **first column**. If the course isn't linked to a card, `no_linked_card`: CourseForge keeps the review **pending** and retries on its scheduler tick (30 days), so linking a card later still brings the review across. |
| The card | "Review: {link title}", due on the link's expiry date, linked to the course (`CardCourse`) and **related** (`CardLink`) to the course's card. The person who made the link is assigned and watching, when they signed in with Tavoro. The review link's secret URL is never sent; the card links to the course in CourseForge. |
| A comment | A subtask "{reviewer}: {comment}" (full text, where it is, and a link in its description). **Top-level comments only**: replies aren't mirrored, but a reviewer's reply that re-opens a resolved thread re-opens its subtask. New unresolved comments notify the card's watchers. |
| Resolved / re-opened | Moves the subtask's **done** only when the comment's state *changes* in CourseForge (`SuiteItem.state`), so ticking a subtask yourself isn't undone by a later sync. The last subtask being ticked fires the board's `subtasks_done` automation as usual. |
| Deleted here | Deleting the card or a subtask leaves a **tombstone** (`SuiteItem.cardId` null): it isn't made again, and CourseForge stops retrying. |

`SuiteItem { appId, kind: review | review-comment, externalId, cardId, state }` maps CourseForge's ids to
cards; `(appId, kind, externalId)` is unique, so two syncs at once can't make two cards.

Not done: ticking a subtask in Tavoro doesn't resolve the comment in CourseForge; comments made
before CourseForge was connected, and the studio's own (non-review) comments, aren't sent.

Test: CourseForge `apps/studio/tests/tavoro-reviews.e2e.mjs` (29 checks).


## Step 5: live packages and learner results

CourseForge's course summary (the same one cards use) has a `live` object: packages, standards,
latest version, launches, last launch, and `results` (sessions, completed, passed, failed, average
score and progress) when the players have reported. See CourseForge `docs/TAVORO.md` for how the
player reports (anonymous, per launch, no identity).

Where Tavoro shows it:

- **Card drawer → Course:** a line under the course with the package, version and results.
- **Content item → In the LMS:** for an item whose deliverable's card has a course with live
  packages. Not shown when the card is private.
- **Reports → Learning** (admins and managers): live courses, launches, finished and pass rates,
  average score, and a table by course. A private card's course is left out; a course linked to two
  cards counts once. It is the current picture, so the time range doesn't apply.

Finished means the learner reached an end state: completed, passed or failed. Pass rate is passed of passed + failed, and is blank for a
course without a graded result. Numbers are as fresh as the card's summary (10 minutes).

Limits: results are advisory (the package token is public inside an LMS); the LMS stays the
record of who completed what; packages uploaded before this feature report launches only until
re-uploaded.
