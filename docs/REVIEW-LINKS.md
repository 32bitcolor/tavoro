# Review links — contextual SME review, for any authoring tool

**Status:** design proposed, nothing built.
**Owner:** @32bitcolor
**Pillar:** deepens pillar 2 (SME review & approval) in [the vision](../README.md#the-vision).
That pillar is marked ✅, but it's the thinnest of the live three — this doc is about making it
deserve the checkmark.

## Why

The README calls SME review *"the #1 daily bottleneck"* and lists the pain: *"feedback scattered
across email and PDFs, no version control, no deadlines."* Today's review cycles solve the
deadlines. They don't solve the other two, and the current model has three gaps that keep SMEs
in email:

1. **Reviewers must be workspace members.** `addReviewCycle` rejects anyone without a
   `Membership` (*"Reviewer must be a workspace member."*). SMEs are usually outside L&D and
   over-allocated; asking them to accept an account in yet another tool is where reviews go to
   die. So designers export to PDF, email it, and collect markup by hand — the exact scatter the
   pillar promises to end.
2. **Feedback is one text box per reviewer.** `ReviewCycle.feedback` is a single
   `String?` (capped at 5000 chars). An SME can't say *"screen 14, narration, second sentence is
   wrong"* except by writing those words. The designer then re-locates every point by hand.
3. **A review isn't tied to what was reviewed.** A cycle points at a `Deliverable`, not at a
   version of anything. When the storyboard changes after round 1, there's no record of what the
   SME actually saw, and no way to show round 2's reviewer *what changed since last time* — which
   is the single most common SME complaint about re-reviews.

There's also a modelling wart worth fixing on the way: `round` is computed per *deliverable*, so
sending one draft to two SMEs creates rounds 1 **and** 2 for what is really one round with two
reviewers.

The market gap is specific. Articulate Review 360 does contextual review well — for Articulate
content only. zipBoard and similar are review-only tools disconnected from the project, the
objectives and the board. Tavoro already owns the storyboard, the deliverable, the reviewer
loop and the board where fixes happen; contextual review is the missing link between them.

## The boundary — read this first

Tavoro removed a course-authoring module (`ab20824`) and an exam builder for crossing the
*"sits above the tools"* line. Review has its own version of that trap: **hosting and running
courses.** Playing SCORM packages or Storyline output inside Tavoro means a SCORM runtime,
iframe sandboxing of arbitrary uploaded JS, and an LMS-shaped feature nobody asked us to build.

**Locked:** Tavoro reviews **artifacts it can render safely without executing them**:

| Target | How it's reviewed | Anchor precision |
|---|---|---|
| **Tavoro storyboard** | Native, from a frozen snapshot | Screen → field → quoted text |
| **PDF** (exported Storyline/Rise, design docs) | In-browser PDF render | Page → point/region |
| **Image** (mockups, screenshots) | Inline | Point/region |
| **Video** (MP4 recordings of a course walkthrough) | HTML5 player | Timestamp (+ optional region) |
| **External URL** (Rise/Review 360 share link) | Link out; comments stay in Tavoro | General, or a free-text "where" label |

No SCORM, no HTML5 packages, no uploaded JS — ever. "Record a walkthrough video or export a PDF"
is the supported path for authoring-tool output, and it's what SMEs already receive today.

## Locked decisions

1. **Guests are not Users.** A guest SME gets a **review link**, not an account. No row in
   `User`, no `Membership`, nothing that the existing authz getters (`getReviewForUser` et al.)
   can ever return. Guest access goes through a separate, deliberately tiny module
   (`lib/review-guest.ts`) that can only reach the one round its token names. Rejected: creating
   lightweight "guest users" — every list, search and group-visibility query in `authz.ts` would
   then have to learn to exclude them, and one miss leaks the workspace.

2. **Links are unforgeable from the database, exchanged for a cookie, and scoped to one reviewer.**
   - *Amended in phase 2 (2026-10-21).* A link is `<guestId>.<HMAC-SHA256(SESSION_SECRET, guestId:nonce)>`
     (`lib/review-guest-token.ts`). Only a random per-guest **nonce** is stored, so a database dump
     still can't mint or replay a link, as the original "store only a hash" design intended. But
     the app can re-create the link, which makes reminder emails and a designer's **Copy link**
     possible. **Reset link** rotates the nonce, which kills the old link at once. Rotating
     `SESSION_SECRET` kills every guest link, along with every session. Rejected: a random token
     stored only as a hash. It can never be shown or re-sent, so every reminder would need a new
     link that invalidates the one in the guest's inbox.
   - `GET /review/<token>` validates, sets an httpOnly, Secure, `SameSite=Lax` cookie scoped to
     `Path=/review/g/<guestId>` (so one browser can hold several reviews), then **redirects to a
     token-free URL**. The token leaves the address bar,
     browser history, screenshots and `Referer` headers after first use.
   - The page sends `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`.
   - Expiry defaults to the round's due date + 14 days (capped at 90), and every link is
     **revocable**. A new round mints new links; old ones become read-only.
   - Possession of the link is the credential (same trust model as the intake form, but
     per-person and expiring). **Decided 2026-10-20: link-only is acceptable**, compliance
     content included. An optional **email verification code** stays in phase 5 as hardening,
     not a prerequisite.
   - Redis rate limiting reuses the `intake-throttle.ts` pattern (fail open, per IP).

3. **Review against a frozen snapshot, never the live record.** Starting a round freezes the
   storyboard into JSON on the round (screens + every TipTap field). Comments anchor to the
   snapshot, so editing the storyboard mid-review can't orphan or silently move feedback — and
   comparing round N's snapshot with round N−1's gives **"changed since your last review"**
   badges per screen and per field for free. Uploaded files are immutable by construction (new
   version = new file on the next round).

4. **Rounds become real.** New `ReviewRound` (deliverable, number, target, snapshot, due date);
   the existing `ReviewCycle` becomes **one reviewer's assignment and decision within a round**.
   Migration backfills one round per existing cycle, keeping its `round` number, so history is
   unchanged and nothing is renumbered. New rounds can then carry several reviewers.

   **A round passes only when every reviewer approves** (decided 2026-10-20). "Approve with minor
   changes" counts as approval. Any "request changes" keeps the round open. **ADMIN and MANAGER
   users can override** and pass a round anyway, for example when an SME has gone silent. An
   override requires a reason and records who did it and when; it never rewrites the reviewers'
   own decisions. The round then shows *"Passed by override — 2 of 3 approved"*, and the email to
   the requester says the same. MEMBERs don't see the control, and the server action checks the
   role rather than trusting the UI.

5. **Anchors are versioned JSON with a lenient parser** — the `lib/saved-views.ts` pattern. One
   `anchor Json` column plus a zod union in `lib/review-anchor.ts`:
   `storyboard_field` (screenId, field, optional text-quote with prefix/suffix), `file_point`
   (page, x, y as 0–1 fractions), `file_region` (page, x, y, w, h), `video_time` (seconds,
   optional region), `general`. Unknown/malformed anchors degrade to `general` instead of
   erroring. Rejected: a column per anchor type — five nullable column groups that grow with
   every new target.

6. **Guests can't @-mention.** The mention picker would hand an outsider the member list. Guest
   comments use the TipTap editor with the mention extension off; staff replies keep mentions.

7. **One round, one notification to the designer.** Comments don't email per keystroke. A guest
   *submitting a decision* emails the requester once, with counts (*"Dr. Patel requested changes:
   14 comments, 3 on screens changed since round 1"*). Staff @-mentions in replies notify as
   today. Everything stays under the existing `review` notification key.

8. **Feedback becomes work through the board, not a parallel tracker.** Open comments can be
   converted to cards (one card per comment, or one card with a checklist) on a chosen board;
   the comment keeps a `cardId` back-link. Rejected: a separate "feedback task" model — the
   board already is the task system.

## Data-model diff

Grounded in the current schema (`ReviewCycle`, `Deliverable`, `Storyboard`, `Screen`).

### New

```prisma
// One round of review on a deliverable: what was reviewed, frozen, plus who reviewed it.
model ReviewRound {
  id            String    @id @default(cuid())
  deliverableId String
  number        Int       // 1, 2, 3… per deliverable — unique together
  targetKind    String    // storyboard / file / external_url
  // Frozen copy of the storyboard at round start (screens + TipTap fields). Null for files/URLs.
  snapshot      Json?
  fileId        String?   // targetKind = file
  externalUrl   String?   // targetKind = external_url
  dueDate       DateTime?
  createdById   String?
  closedAt      DateTime? // set when every assignment is decided, or closed manually
  // Outcome. "passed" needs every assignment approved — or an ADMIN/MANAGER override.
  outcome        String?   // null while open / passed / changes_requested
  overriddenById String?   // set only when an ADMIN/MANAGER passed the round without full approval
  overriddenAt   DateTime?
  overrideReason String?   // required with an override
  createdAt     DateTime  @default(now())

  deliverable  Deliverable     @relation(fields: [deliverableId], references: [id], onDelete: Cascade)
  file         ReviewFile?     @relation(fields: [fileId], references: [id], onDelete: SetNull)
  createdBy    User?           @relation(fields: [createdById], references: [id], onDelete: SetNull)
  overriddenBy User?           @relation("ReviewRoundOverride", fields: [overriddenById], references: [id], onDelete: SetNull)
  assignments ReviewCycle[]
  comments    ReviewComment[]

  @@unique([deliverableId, number])
}

// A guest reviewer's credential for one assignment. No User, no Membership.
model ReviewGuest {
  id         String    @id @default(cuid())
  name       String
  email      String
  tokenHash  String    @unique // sha256(token) — the raw token is never stored
  expiresAt  DateTime
  revokedAt  DateTime?
  lastSeenAt DateTime?
  createdAt  DateTime  @default(now())

  assignment ReviewCycle?
  comments   ReviewComment[]
}

model ReviewComment {
  id           String    @id @default(cuid())
  roundId      String
  parentId     String?   // one level of threading, like Card subtasks
  authorId     String?   // exactly one of authorId / guestId (CHECK constraint in migration)
  guestId      String?
  body         String    // TipTap JSON
  anchor       Json      // see lib/review-anchor.ts — validated + leniently parsed
  status       String    @default("open") // open / resolved / wont_fix
  resolvedById String?
  resolvedNote String?
  cardId       String?   // set once converted to a board card
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  round      ReviewRound     @relation(fields: [roundId], references: [id], onDelete: Cascade)
  parent     ReviewComment?  @relation("Thread", fields: [parentId], references: [id], onDelete: Cascade)
  replies    ReviewComment[] @relation("Thread")
  author     User?           @relation("ReviewCommentAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  guest      ReviewGuest?    @relation(fields: [guestId], references: [id], onDelete: SetNull)
  resolvedBy User?           @relation("ReviewCommentResolver", fields: [resolvedById], references: [id], onDelete: SetNull)
  card       Card?           @relation(fields: [cardId], references: [id], onDelete: SetNull)

  @@index([roundId, status])
}

// An immutable file under review (PDF / image / MP4). Not an Attachment: Attachment.cardId is
// required and cascades from Card — same reasoning as Asset in CONTENT-LIFECYCLE-REUSE.md.
model ReviewFile {
  id           String   @id @default(cuid())
  workspaceId  String
  fileName     String
  mimeType     String
  sizeBytes    Int
  storageKey   String   @unique
  uploadedById String?
  createdAt    DateTime @default(now())

  rounds ReviewRound[]
}
```

### Changed

```prisma
model ReviewCycle {            // now: one reviewer's assignment + decision within a round
  roundId    String            // NEW — backfilled, then made required
  reviewerId String?           // was required; exactly one of reviewerId / guestId (CHECK)
  guestId    String? @unique   // NEW
  decidedAt  DateTime?         // NEW — turnaround reporting (phase 5) needs it
  // round, status, dueDate, feedback stay. `round` is kept for history and mirrors
  // ReviewRound.number; `feedback` becomes the optional summary that goes with a decision.
}
```

The migration is hand-written (Prisma can't express the CHECK constraints or the backfill),
following `20260812221500_workspace_level_labels`:
1. Create `ReviewRound`; insert one row per existing `ReviewCycle` (`number = round`,
   `targetKind = 'storyboard'` if the deliverable has a storyboard else `'external_url'` with a
   null URL, `snapshot = NULL` — legacy rounds have no snapshot, and the UI says so).
2. If two legacy cycles share `(deliverableId, round)` — impossible today since round is
   computed per deliverable, but checked anyway — fold them into one round.
3. Set `ReviewCycle.roundId`, make it NOT NULL, relax `reviewerId`, add both CHECKs.

### Code that has to change with it

- `addReviewCycle` splits into **`startReviewRound`** (snapshot + target + reviewers, Serializable
  like today) and **`addReviewer`** (an extra reviewer on an open round).
- `lib/storage.ts`: `putObjectBytes` takes a fully buffered `Uint8Array`
  (`await file.arrayBuffer()` in the upload route). Fine at 25 MB, **not fine for video**. Review
  files need a streamed multipart upload (`@aws-sdk/lib-storage` `Upload`) and a higher, separate
  cap: **500 MB** (decided 2026-10-20; revisit once real walkthrough recordings show up).
  Caddy/Cloudflare limits matter too: Cloudflare's free plan caps a request body at 100 MB, so
  public uploads over that size need chunking (S3 multipart parts sent as separate requests through
  the app) rather than one big POST. Generalise `buildObjectKey` with a scope the way the content-lifecycle
  doc proposes (`workspace/{id}/review/{fileId}/…`) — the two docs should share one change.
- Video playback needs **HTTP Range** support on the download route, which streams through the
  app today. Without it, seeking to a timestamped comment won't work in Safari at all.
- `lib/reminders.ts` doesn't remind **reviews** today — only cards and milestones. Add review
  assignments due tomorrow (staff and guests) to the same daily scan.
- `src/proxy.ts`: add `/review/` to `PUBLIC_PREFIXES`. That route group must not import the
  `(app)` layout or anything from `authz.ts`.
- `lib/workspace-backup.ts`: add the four models, bump `BACKUP_FORMAT` 4 → 5, with an upgrade path
  for format-4 files the way `upgradeLegacyLabels()` handled format 3. **Guest tokens aren't
  exported**: a restored workspace gets dead links by design, and a backup file can't be used to
  hijack reviews.
- The dead presign helpers in `lib/storage.ts` (`presignUpload` / `presignDownload` /
  `presignView`, unused since `be2f62a`) should be deleted in the same PR that touches storage.

## The experience

**Designer:** Deliverable → *Start review round* → pick the target (the linked storyboard is
pre-selected; or upload a PDF/image/MP4; or paste a URL) → add reviewers, each either a member or
*name + email* → due date → *Send*. Each guest gets an email with their personal link. The round
page shows each reviewer's progress (opened / N comments / decided) and every comment, filterable
by screen, status and reviewer.

**Guest SME:** clicks the link and lands on a clean page with no app chrome: deliverable name, due
date, *what changed since your last review* (round 2+), and the content. They select text or click
a spot to comment. When done: **Approve**, **Approve with minor changes**, or **Request changes**,
with an optional summary. They can come back until the link expires; after deciding, the page
becomes read-only, with a *Reopen* option until the round closes.

**Back to work:** the designer replies or resolves (*resolved* / *won't fix* + note, which the SME
sees). They multi-select open comments → *Create cards* → board. Starting round 2 carries
unresolved comments forward as context, and highlights the screens that changed.

*"Approve with minor changes"* is a new status. Real SMEs use it constantly, and today they have
to pick between blocking the project and approving something they wanted changed. It counts as
approved for gating and shows its comments as follow-ups.

## Phases

All phases are additive. Each one ships something usable, and it's fine to stop after any of them.

1. ✅ *Shipped 2026-10-21.* **Real rounds + anchored comments (members only).** `ReviewRound`, snapshots, the
   `ReviewCycle` migration, storyboard-field anchors, threads, resolve, and the
   "changed since last round" diff. This is valuable before any guest ever sees a link, and it's
   where the risky migration happens.
2. ✅ *Built 2026-10-21.* **Guest review links.** `ReviewGuest`, the token→cookie exchange, the public `/review` route
   group, rate limits, expiry and revoke, invite and decision emails, review due-date reminders,
   and the "Approve with minor changes" status.
3. ✅ *Built 2026-10-21 (PDF + images; video deferred).* **File targets.** `ReviewFile`, streamed large uploads, Range downloads, and PDF (pdf.js),
   image and video anchors.
4. ✅ *Built 2026-10-22.* **Feedback → work, and export.** Comments → cards, a consolidated feedback view, and
   **storyboard + comments export to Word/PDF**. This folds in the long-requested storyboard
   export, since export is how reviews leave the building anyway.
5. **Hardening and insight.** An optional email-code check for guests, an external-URL target,
   and **SME turnaround reporting** (median days to decision per reviewer/project, from
   `decidedAt`). The last one is the first real data point for the "proving impact" pillar.

## Out of scope

- Running SCORM, xAPI or HTML5 packages, or any uploaded code (see the boundary above).
- Annotating *inside* an external site. Cross-origin iframes make it impossible, and a browser
  extension is a different product.
- Real-time co-presence or live cursors. Reviews are asynchronous by nature.
- Guest accounts, guest dashboards, or guests seeing anything beyond their own round.

## Open questions

1. ~~**Guest identity:** is link-only access acceptable?~~ **Resolved 2026-10-20: yes**, including
   compliance content. The email-code check stays in phase 5.
2. ~~**Multi-reviewer gating**~~ **Resolved 2026-10-20:** every reviewer must approve, and
   ADMIN/MANAGER can override with a recorded reason. See locked decision 4.
3. ~~**Video size cap**~~ **Resolved 2026-10-20:** start at 500 MB. Mind the 100 MB Cloudflare
   body limit (see "Code that has to change").
4. ~~**Who sees guest comments?**~~ **Resolved 2026-10-20:** anyone with access to the
   deliverable's project, under the existing group visibility rules. Nothing guest-specific.

No open questions remain.

### Phase 2 as built

- `ReviewGuest` (name, email, nonce, expiry, revoked, last seen). `ReviewCycle.reviewerId` is now
  optional, with a `guestId` and a CHECK that exactly one is set. `ReviewComment.guestId` has a CHECK
  that at most one author is set, because deleting an author nulls the column.
- `/review/<token>` → cookie → `/review/g/<guestId>`. Revoked, expired and bad links go to
  `/review/unavailable`. The pages have no app shell, send `Referrer-Policy: no-referrer` and
  `X-Robots-Tag: noindex`, and never import `authz.ts`.
- Guests comment (no mentions), reply, delete their own comments, and decide. After deciding, the
  page is read-only until they **Reopen**. A newer round, or a round with an outcome, makes it
  read-only. Guests see members' names but never their email addresses.
- Members manage guests from the round page: copy link, re-send invite, reset link, turn off. Any
  member with project access can do this, like every other review action. Members can also add a
  reviewer, member or guest, to an open round.
- **Approve with minor changes** is a new decision for members and guests, and counts toward
  approval.
- Decision emails include the comment counts, including how many are on screens changed since the
  last round. Reminders go out the day before a review is due, to undecided members and guests.
- Rate limits: link exchange is capped at 30 per 10 minutes per IP, and guest comments at 300 per
  hour per guest.
- Backups (format 6) include guests without their nonce, and restore gives them fresh ones, so
  restored links are dead and members re-send them.

### Phase 3 as built (PDF and images; video deferred)

- `ReviewFile` (workspace, deliverable, name, sniffed MIME type, size, storage key, uploader) and
  `ReviewRound.fileId`; `targetKind` is now `storyboard`, `file` or `none`. A file is immutable: the
  next round uploads a new version or reuses the same file, and the round page says which.
- **Upload:** `PUT /api/review-files?deliverableId=…&name=…` with the raw bytes (not multipart).
  The body streams to MinIO through `@aws-sdk/lib-storage` and is never buffered: a 60 MB upload
  through the tunnel left the app at about 300 MB of memory. The type comes from the file's magic
  bytes; only PDF, PNG, JPEG, WebP and GIF are accepted, never SVG. The cap is **95 MB**, enforced
  from Content-Length and again by a byte counter while streaming. It sits under Cloudflare's 100 MB
  body limit, so files this size need no chunking.
- **Serving:** members use `/api/review-files/<id>`, gated by the deliverable's access rules.
  Guests use `/review/g/<guestId>/file`, sent with their path-scoped cookie and limited to their
  own round's file. Both honour HTTP Range (206) and send `nosniff`, `CSP: sandbox; default-src
  'none'` and `Content-Disposition: inline` (or `attachment` with `?download`).
- **Rendering:** pdf.js 6 draws each page into a canvas lazily, near the viewport, and redraws on
  resize. There's no text layer, no annotation layer and no XFA, so nothing in a PDF runs. The
  worker, CMaps, standard fonts, WASM decoders and ICC profiles are copied into `public/vendor/pdfjs`
  by `scripts/copy-pdf-worker.mjs` before dev and build, so they always match the installed version.
- **Anchors:** `file_point` and `file_region` (page, plus 0–1 fractions). Click to pin, drag with a
  mouse to mark an area, or use **Comment on page N** (keyboard path; stored as a whole-page
  region). Markers are numbered in thread order and link both ways with the comments panel.
- **Quoting PDF text** (added 2026-10-21): pdf.js's text layer sits over each canvas, invisible
  but selectable. Selecting text inside one page offers **Comment on selection**, stored as a
  `file_region` (the selection's bounding box) with a `quote`, shown on the thread like a storyboard
  quote. Pressing on text selects rather than starting a region drag; a plain click on text still
  pins. Touch long-press selection works too. Scanned PDFs have no text to select.
- **Unused uploads** (added 2026-10-21): cancelling or picking another file deletes the upload at
  once. A nightly worker job (04:30 UTC, `lib/review-file-sweep.ts`) removes review files no round
  uses after a 24-hour grace period, plus review-file objects whose rows went away when a
  deliverable, project or workspace was deleted. The worker now gets the S3 settings.
- **Video, as built (2026-11-08):** MP4 (ISO media with a video brand; HEIC/AVIF are refused)
  and WebM, sniffed like the rest and played by the browser's own `<video>` (Range serving was
  already there). `video_time` anchors carry `t` (seconds) and an optional `x`/`y` pin on the
  frame; they're numbered with file pins, described as "At 1:23 · #2" on cards, the feedback
  page, MCP and the Word export (one Video section in time order). `components/review/video-review.tsx`:
  "Comment at m:ss" (pauses), "Pin on the frame" (one click on a layer that stops short of the
  native controls), timeline markers that seek, and pins shown on the frame within 1.5 s of their
  moment. MCP `add_review_comment` takes `at` ("1:23").
- **Large files (2026-11-08):** over 95 MB, the browser uploads in 50 MB parts
  (`/api/review-files/multipart`: start → PUT each part → complete), each its own request, so none
  hits Cloudflare's 100 MB cap; up to 500 MB. The app passes parts to the store's own multipart
  upload (pending state in Redis, 24 h, bound to the uploader); the type is sniffed once the file is
  whole and the size checked against what was declared, and anything else is deleted. Failed parts
  retry twice; a cancelled or failed upload is aborted. MinIO aborts stale incomplete uploads after
  24 h itself; on S3 the nightly sweep does.
- Backup format 7 carries review files with their bytes, re-uploaded on restore. The dead presign
  helpers, `S3_PUBLIC_ENDPOINT` and `@aws-sdk/s3-request-presigner` are gone.

### Phase 4 as built

- **Comments → cards.** `ReviewComment.cardId` (nullable, `SET NULL` when the card is deleted)
  records the card a thread became. *Send to board* on an open thread, or on a selection in the
  feedback view, picks a board and column (the project's boards first; the default is the board of
  the card the deliverable is linked to). Several comments go to **one card each**, or to **one
  card with a subtask per comment** (each comment then links to its subtask). A card's description
  quotes the comment, carries its text (mentions flattened to `@Name`), says who, which round and
  where, and links back to `/reviews/<roundId>?thread=<id>`. Already-sent comments are skipped, so
  sending twice never makes two cards. Members only (`app/actions/review-feedback.ts`).
- **Back from the card.** The card panel lists its review comments under *Review feedback*. When
  the card is in a `done` status category, or the comment's subtask is ticked, it offers to resolve
  them in one click. Comments on projects the member can't see are left out. Resolving stays a
  deliberate step: closing a card never changes a comment by itself.
- **Feedback view** at `/reviews/feedback/<deliverableId>` (linked from the deliverable and every
  round): all threads across all rounds, grouped by screen (named and ordered by the newest
  snapshot that has it), by PDF page, or as general feedback. Filters: status, reviewer, round, and
  on a board or not. Selected threads can be resolved, marked won't fix (one shared note) or
  reopened together, or sent to a board.
- **Deep links:** `?thread=<id>` on a round page scrolls to the thread and highlights it, switching
  to *All* if it's closed.
- **Export.** One neutral document model (`lib/review-export.ts`, with `lib/rich-text.ts`
  flattening TipTap JSON) renders two ways:
  - **Word:** `lib/docx.ts` writes the WordprocessingML by hand and zips it with `fflate` (already a
    dependency). No template, no numbering part. Served from `/api/review-rounds/<id>/export` and
    `/api/storyboards/<id>/export`.
  - **PDF:** the print views at `/print/reviews/<id>` and `/print/storyboards/<id>` (no app chrome,
    paper styling whatever the theme), printed with the browser's *Save as PDF*. The page title is the
    document's name, so it becomes the PDF's file name. No headless browser on the server.

  A round's export has the meta (project, what was reviewed, outcome, dates, comment counts), the
  reviewers with decisions and summaries, then general feedback, then each screen with its fields
  and each comment (status, quote, replies, resolution note) under the field it's about. File rounds
  list comments by page. A storyboard export is the same without comments.
- Backup format 8 carries `ReviewComment.cardId`, remapped to the restored card.
