# Tavoro as an MCP server

*Built 2026-10-22.* Tavoro speaks the [Model Context Protocol](https://modelcontextprotocol.io), so
Claude (Claude.ai, Claude Desktop, Claude Code) and other MCP clients can read and work in a workspace
as a signed-in member. This doc records what was built and why.

## Decisions

1. **One remote endpoint, every client.** `POST /api/mcp`, Streamable HTTP transport, **stateless**
   (a fresh server per request, JSON responses, no sessions). `GET` and `DELETE` answer 405, as the
   spec allows. An open GET event stream carried nothing here, and through Cloudflare it held up the
   client's next request.
2. **Two kinds of credential, one table.** `ApiToken` rows are either *personal tokens*
   (`tav_…`, made in Settings, pasted into a client) or *OAuth connections* (`tavo_…` access +
   `tavr_…` refresh, issued after the consent screen). Only SHA-256 hashes are stored. Each one acts
   as **one user in one workspace** with scope `read` or `read write`.
3. **MCP reuses the app's permission model instead of copying it.** The route authenticates the
   bearer token and runs the whole request inside `runAsPrincipal()` (`AsyncLocalStorage`,
   `lib/principal.ts`). `getSession()` returns the token's user and workspace from there, so
   `getCurrentUser`, `getActiveMembership`, every `get…ForUser` check and every server action behave
   exactly as they do in the browser. While a principal is set, `authz.ts` also limits workspace
   ownership and elevated roles to the token's workspace, so a token can't reach another workspace
   the same user belongs to, and `getActiveMembership` never falls back to another workspace.
4. **Tools are thin wrappers over server actions.** Writes call the same actions the UI calls
   (validation, revalidation, emails, notifications included). Reads query Prisma with the same
   visibility `where` fragments the pages use. Write tools aren't even registered for a read-only
   connection. Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`,
   `idempotentHint`) so clients can ask before deleting.
5. **Markdown at the boundary.** Descriptions, comments and storyboard fields are TipTap JSON in the
   database and Markdown in tools (`lib/markdown.ts`, both directions: headings, lists (nested),
   quotes, code, bold/italic/strike/code, links, hard breaks). Mentions become `@Name` text; MCP
   writes don't send mention emails.
6. **OAuth 2.1 built in.** Tavoro is both the authorization server and the resource server:
   - RFC 9728 protected-resource metadata and RFC 8414 server metadata, at the `/.well-known/…` paths
     through `next.config.ts` rewrites (the App Router can't route a dot-folder);
   - **Client ID Metadata Documents** (the MCP spec's preferred registration, and ChatGPT's first
     choice): a client_id that is an https URL is fetched (`lib/oauth-cimd.ts`; public addresses
     only, no redirects, 5 s, 64 KB), checked (`client_id` must equal the URL, redirect URIs must
     pass the same rules as registration, `none` auth), stored as a client and refreshed hourly;
   - RFC 7591 dynamic registration (open, throttled to 20/hour per IP; redirect URIs must be https,
     loopback http, or an app scheme, never `javascript:`/`data:`/`file:`). Public clients (`none`,
     PKCE) by default; `client_secret_basic` / `client_secret_post` clients get a `tavs_` secret,
     stored hashed, and must present it at the token endpoint;
   - loopback redirects (`localhost`, `127.0.0.1`, `[::1]`) match on any port (RFC 8252), since
     desktop clients and CLIs pick a free one at run time;
   - RFC 9207 `iss` on every authorization response, and RFC 8707 `resource` checked on the
     authorize and token requests (it must name this server or `/api/mcp`);
   - authorization-code flow with **PKCE S256 required** and a consent page at `/oauth/authorize`
     where the member picks the workspace and access level;
   - 10-minute single-use codes, 1-hour access tokens, 30-day refresh tokens rotated on every use
     (the old refresh and access tokens die immediately); RFC 7009 revocation.

   The 401 from `/api/mcp` carries `WWW-Authenticate: Bearer resource_metadata=…, scope="read write"`,
   which is how clients discover all of this from just the URL.
7. **Lenient where clients differ.** A POST missing `application/json` or `text/event-stream` in
   `Accept` is served anyway (some clients send only one). Tools that return objects also return
   them as `structuredContent`, and `search`/`fetch` declare output schemas.
8. **`search` + `fetch`, the document pair.** `search(query)` returns `{ results: [{ id, title, url }] }`
   and `fetch(id)` returns `{ id, title, text, url, metadata }` with the item as a full Markdown
   document (`lib/mcp/documents.ts`). That's the shape ChatGPT's deep research and company knowledge
   require, and it suits any assistant that wants to read rather than navigate. Ids are
   `card:…`, `project:…`, `deliverable:…`, `board:…`, `storyboard:…`, `review:…`, `intake:…`, `whiteboard:…`, `content:…`.
9. **People stay in control.** Settings → **AI & MCP** shows each connection with last use, and
   revokes it at once. Admins see and can revoke everyone's in their workspace. Tokens can only be
   created from the browser, never through MCP. Login now honours `?next=` (same-site paths only),
   so signing in mid-flow returns to the consent page.

## What's exposed

**Tools (56 with read and write access, 19 read-only):**

| Area | Read | Write |
| ---- | ---- | ----- |
| Workspace | `get_workspace` (you, access, members, statuses, labels, sprints), `search`, `fetch`, `get_my_work` | |
| Boards & cards | `list_boards`, `get_board`, `get_card` (by id or key, e.g. SEC-12; an epic includes its cards), `list_epics` | `create_board`, `create_column`, `create_card`, `update_card` (title, type, priority, estimate, epic, Markdown description, due, column, board (moves it), assignees, SMEs, labels, sprint, private), `add_card_comment`, `add_subtasks`, `set_subtask_done`, `delete_card`* |
| Projects | `list_projects`, `get_project` | `create_project`, `update_project`, `delete_project`*, `add_phase`, `update_phase`, `create_deliverable`, `update_deliverable`, `create_milestone`, `update_milestone`, `add_objective`, `add_assessment_item`, `log_time` |
| Storyboards | `list_storyboards`, `get_storyboard` | `create_storyboard`, `update_storyboard`, `add_screens`, `update_screen` (fields, position, objectives), `delete_screen`* |
| Reviews | `list_reviews`, `get_review_round`, `get_deliverable_feedback` | `add_review_comment` (on a screen and field with a quote, a PDF page, a video moment (`at`), or the whole round; or a reply), `set_review_comment_status`, `decide_review`, `start_review_round`, `send_comments_to_board` |
| Planning | `list_intake`, `get_intake`, `get_sprint` | `triage_intake`, `create_sprint`, `update_sprint` |
| Whiteboards | `list_whiteboards`, `get_whiteboard` (items, positions, colours, frames, and arrows with what they connect) | `create_whiteboard` (optionally linked to a card or storyboard), `add_to_whiteboard` (boxes, ellipses, diamonds, sticky notes, text, frames, arrows; refs connect items in one call; unplaced items are laid out in rows), `add_diagram` (nodes + edges, laid out top-down or left-to-right with dagre, optionally in a titled frame), `update_whiteboard` (rename; move, resize, relabel, recolour, dash or delete items) |
| Content | `list_content` (by lifecycle: attention, expired, review_overdue, expiring, review_due, …), `get_content` (incl. dependencies), `list_content_sources` | `create_content`, `update_content` (dates, cadence, owner by email, labels by name), `mark_content_reviewed`, `track_deliverable`, `add_content_dependency` / `remove_content_dependency`, `flag_content_change` (with `preview`) |
| Assets | `list_assets` (by type, label, unused, archived), `get_asset` (incl. where it's used) | `add_asset_link`, `update_asset` (name, type, description, labels, archive), `attach_asset` / `detach_asset` (record which content uses it) |
| Question bank | `list_bank_items` (by kind, type, level, label, unused, archived), `get_bank_item` (incl. the projects using it) | `create_bank_item`, `update_bank_item` (incl. labels, archive), `copy_bank_item_to_project`, `save_assessment_item_to_bank` |
| Templates | `list_templates` | `create_project_from_template` (dates shifted to `start_date`), `create_storyboard_from_template` (standalone or for a deliverable), `save_as_template` (new or replace) |

\* destructive

**Resources:** `tavoro://project/{id}`, `tavoro://board/{id}`, `tavoro://storyboard/{id}`,
`tavoro://whiteboard/{id}`, `tavoro://card/{ref}` and `tavoro://review-round/{id}`, as JSON. All except cards are listable.

**Prompts:** `status_report`, `summarize_feedback`, `draft_storyboard`, `triage_intake`,
`plan_sprint`. Each one embeds the relevant data and asks the model to confirm before changing
anything.

## Connecting other assistants

| Client | How |
| ------ | --- |
| Claude.ai / Claude Desktop | Settings → Connectors → Add custom connector → `https://<host>/api/mcp`. OAuth via dynamic registration. |
| Claude Code | `claude mcp add --transport http tavoro https://<host>/api/mcp` (OAuth), or add `--header "Authorization: Bearer tav_…"`. |
| ChatGPT | Settings → Apps → Advanced → Developer mode → Create app → URL `https://<host>/api/mcp`, auth OAuth. Signs in with its metadata document (`https://chatgpt.com/oauth/client.json`). Deep research and company knowledge use `search`/`fetch`; the other tools work in developer-mode chats. |
| Codex CLI | `~/.codex/config.toml`: `[mcp_servers.tavoro]` `url = "https://<host>/api/mcp"`, then `codex mcp login tavoro`; or `bearer_token_env_var = "TAVORO_TOKEN"` with a personal token. |
| Cursor | `.cursor/mcp.json`: `{"mcpServers":{"tavoro":{"url":"https://<host>/api/mcp"}}}`; OAuth on first use, or add `"headers":{"Authorization":"Bearer tav_…"}`. |
| VS Code (Copilot) | `.vscode/mcp.json`: `{"servers":{"tavoro":{"type":"http","url":"https://<host>/api/mcp"}}}`. |
| Gemini CLI | `~/.gemini/settings.json`: `{"mcpServers":{"tavoro":{"httpUrl":"https://<host>/api/mcp"}}}`, then `/mcp auth tavoro`; or `"headers"` with a personal token. |
| Anything else | Any Streamable-HTTP MCP client, with OAuth or `Authorization: Bearer tav_…`. |

## Not exposed (on purpose)

Uploads (attachments, review files, images on whiteboards) stay in the browser. So do workspace settings,
members, groups, backups and self-update, and guest-link management (copy, reset, revoke). Personal
tokens can't be minted over MCP. Backups don't include tokens or OAuth clients: a restored workspace
has no working credentials.

## Whiteboards

*Added 2026-10-23.* Excalidraw can't run on the server (it needs a DOM), so
`lib/whiteboard-elements.ts` builds Excalidraw elements itself, in the shape Excalidraw saves:
labels wrapped and centred in their shape with widths from a measured Excalifont table (shapes grow
to fit), arrows routed edge to edge and bound at both ends, fractional `index`es after the current
top element. Assistants work in *items* (`box`, `note`, `frame`, `arrow` from/to…), never raw elements.

Before this, a whiteboard was saved last-write-wins from the browser, which also saved on mount and
on every scroll, and an open tab never reloaded, so a server-side edit would have been overwritten
within seconds. Now:

- `Whiteboard.sceneVersion` is bumped on every write, and `lib/whiteboard-store.ts` `commitScene()`
  only writes if it's unchanged since the read (retrying otherwise).
- Every write merges per element (`lib/whiteboard-scene.ts`): higher `version` wins, then lower
  `versionNonce`, which is Excalidraw's own collaboration rule. Deleted elements travel as tombstones
  (`isDeleted`) and are dropped after 7 days; files no element uses are dropped.
- The browser sends all elements including deleted ones, with the version it last saw. If someone
  else wrote in between, the merged scene comes back and is folded into the canvas without touching
  undo history. It polls every 4 s while visible, and skips saves when only the view changed.

## Operations

- Rate limit: 600 MCP requests per minute per credential (Redis, fails open).
- Nightly at 04:30 UTC, the worker's maintenance job (`lib/oauth-sweep.ts`) deletes codes expired
  for a day, tokens revoked or dead for 30 days, and clients that registered 7+ days ago but never
  connected.
- Code: `src/app/api/mcp/route.ts`, `src/lib/mcp/` (server, util, tools/*), `src/lib/api-tokens.ts`,
  `src/lib/oauth.ts`, `src/app/api/oauth/*`, `src/app/(auth)/oauth/authorize`,
  `src/app/actions/{oauth,api-tokens}.ts`, `src/components/settings/ai-settings.tsx`.

## Ideas for later

- Uploading a PDF to start a file review round from a client (MCP has no file transfer yet; it'd
  need a URL to fetch or base64, capped at 95 MB).
- A rendered picture of a whiteboard (an image result from `get_whiteboard`), for assistants that
  can see; it needs a server-side renderer.
- Server-sent notifications (`listChanged`, resource subscriptions) once a stateful transport is
  worth it.
