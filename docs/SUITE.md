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
2. **Linking.** A Tavoro project or card links to its CourseForge course and shows its status;
   "Open in CourseForge" from Tavoro.
3. **Storyboard → course.** An approved storyboard becomes a CourseForge draft: screens to
   lessons, objectives carried along.
4. **Reviews.** CourseForge review comments arrive as Tavoro cards, so SME turnaround reporting
   covers built courses.
5. **Pillar 5 (LMS).** CourseForge publishes to the LMS; Tavoro's content inventory points at the
   live package; completion data flows back into Tavoro's reports.

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

Membership sync: CourseForge's scheduler calls Tavoro `GET /api/suite/members` (client secret)
every 5 minutes (`TAVORO_SYNC_MS`). Linked accounts not listed as active are suspended
(`disabledAt` + `tavoroSuspended`, sessions revoked) and restored when listed again. CourseForge
owners are never suspended by sync. Names follow Tavoro.

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
