// A local stand-in for the Jira Cloud REST API, for testing the importer
// (docs/JIRA-PARITY.md, phase 5: "no real Jira data to test against").
//
//   node scripts/jira-mock/server.mjs            # API on :4010, "media" host on :4011
//
// Point the app and worker at it with JIRA_ALLOWED_HOSTS=localhost:4010,127.0.0.1:4011
// and connect to http://localhost:4010 as admin@acme.test / mock-token.
//
// Responses follow Jira's documented shapes (API v3 + Agile 1.0): rich ADF, epics via
// `parent`, sub-tasks, sprints, links (incl. a non-standard type), comments over the
// embedded page size, attachments that redirect to a media host (one to a host that
// must be refused, one too big to fetch), people with hidden emails, a 429 with
// Retry-After, and pages capped at 10 results.
//
// Test hooks: POST /__mock/reset, POST /__mock/mutate {"step":"rerun"}, GET /__mock/stats.
import http from "node:http";

const PORT = Number(process.env.JIRA_MOCK_PORT ?? 4010);
const MEDIA_PORT = PORT + 1;
const ORIGIN = `http://localhost:${PORT}`;
const AUTH = `Basic ${Buffer.from("admin@acme.test:mock-token").toString("base64")}`;
const PAGE_CAP = 10;

// ── People ──
const U = {
  maya: { accountId: "acc-maya", displayName: "Maya Okafor", emailAddress: "maya.okafor@example.com", active: true },
  jordan: { accountId: "acc-jordan", displayName: "Jordan Lee", active: true }, // email hidden (privacy)
  priya: { accountId: "acc-priya", displayName: "Priya Nair", active: true }, // hidden, and two members share the name
  pat: { accountId: "acc-pat", displayName: "Pat External", emailAddress: "pat@elsewhere.test", active: true },
  admin: { accountId: "acc-admin", displayName: "Acme Admin", emailAddress: "admin@acme.test", active: true },
};

// ── Statuses (per project) ──
const ST = {
  todo: { id: "10000", name: "To Do", statusCategory: { key: "new", name: "To Do" } },
  prog: { id: "10001", name: "In Progress", statusCategory: { key: "indeterminate", name: "In Progress" } },
  review: { id: "10002", name: "In Review", statusCategory: { key: "indeterminate", name: "In Progress" } },
  qa: { id: "10004", name: "QA Ready", statusCategory: { key: "indeterminate", name: "In Progress" } },
  done: { id: "10003", name: "Done", statusCategory: { key: "done", name: "Done" } },
};

const TYPES = {
  epic: { id: "1", name: "Epic", subtask: false, hierarchyLevel: 1 },
  story: { id: "2", name: "Story", subtask: false, hierarchyLevel: 0 },
  task: { id: "3", name: "Task", subtask: false, hierarchyLevel: 0 },
  bug: { id: "4", name: "Bug", subtask: false, hierarchyLevel: 0 },
  sub: { id: "5", name: "Subtask", subtask: true, hierarchyLevel: -1 },
  spike: { id: "6", name: "Spike", subtask: false, hierarchyLevel: 0 },
};

const FIELDS = [
  { id: "summary", name: "Summary", custom: false, schema: { type: "string", system: "summary" } },
  { id: "customfield_10016", name: "Story point estimate", custom: true, schema: { type: "number", custom: "com.atlassian.jira.plugin.system.customfieldtypes:jsw-story-points" } },
  { id: "customfield_10030", name: "Effort (days)", custom: true, schema: { type: "number", custom: "com.atlassian.jira.plugin.system.customfieldtypes:float" } },
  { id: "customfield_10020", name: "Sprint", custom: true, schema: { type: "array", items: "json", custom: "com.pyxis.greenhopper.jira:gh-sprint" } },
  { id: "customfield_10019", name: "Rank", custom: true, schema: { type: "any", custom: "com.pyxis.greenhopper.jira:gh-lexo-rank" } },
];

const SPRINTS = {
  s0: { id: 1, name: "ACME Sprint 0", state: "closed", boardId: 7, goal: "Kick-off", startDate: "2025-01-06T09:00:00.000Z", endDate: "2025-01-17T17:00:00.000Z", completeDate: "2025-01-17T16:00:00.000Z" },
  s1: { id: 2, name: "ACME Sprint 1", state: "active", boardId: 7, goal: "Module 1 storyboard", startDate: "2025-01-20T09:00:00.000Z", endDate: "2025-01-31T17:00:00.000Z" },
  s2: { id: 3, name: "ACME Sprint 2", state: "future", boardId: 7 },
};

// ── ADF helpers ──
const t = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...c) => ({ type: "paragraph", content: c });
const doc = (...c) => ({ type: "doc", version: 1, content: c });

const RICH = doc(
  { type: "heading", attrs: { level: 2 }, content: [t("Goals")] },
  p(t("Learners can "), t("spot phishing", [{ type: "strong" }]), t(" — see "), t("the brief", [{ type: "link", attrs: { href: "https://example.com/brief" } }]), t(". Owner: "), { type: "mention", attrs: { id: "acc-maya", text: "@Maya Okafor" } }),
  { type: "bulletList", content: [{ type: "listItem", content: [p(t("Scene 1: inbox"))] }, { type: "listItem", content: [p(t("Scene 2: the call"))] }] },
  { type: "panel", attrs: { panelType: "warning" }, content: [p(t("SME sign-off needed before build."))] },
  { type: "table", content: [
    { type: "tableRow", content: [{ type: "tableHeader", content: [p(t("Screen"))] }, { type: "tableHeader", content: [p(t("Minutes"))] }] },
    { type: "tableRow", content: [{ type: "tableCell", content: [p(t("Intro"))] }, { type: "tableCell", content: [p(t("2"))] }] },
  ] },
  { type: "mediaSingle", attrs: { layout: "center" }, content: [{ type: "media", attrs: { id: "media-uuid-1", type: "file", collection: "", alt: "storyboard.pdf" } }] },
  { type: "codeBlock", attrs: { language: "json" }, content: [t('{"scorm": "1.2"}')] },
);

// ── Issues ──
let issues;
let comments; // issueId → comment[]
let files; // attachment id → { bytes, mime, redirect }
let stats;
let throttled;

function issue(id, key, type, summary, f = {}) {
  return {
    id: String(id),
    key,
    fields: {
      summary,
      issuetype: TYPES[type],
      status: f.status ?? ST.todo,
      priority: f.priority === undefined ? { id: "3", name: "Medium" } : f.priority,
      labels: f.labels ?? [],
      duedate: f.duedate ?? null,
      created: f.created ?? "2025-01-02T10:00:00.000+0000",
      updated: "2025-01-10T10:00:00.000+0000",
      assignee: f.assignee ?? null,
      reporter: f.reporter ?? U.admin,
      description: f.description ?? null,
      parent: f.parent,
      issuelinks: f.issuelinks ?? [],
      attachment: f.attachment ?? [],
      components: f.components ?? [],
      fixVersions: f.fixVersions ?? [],
      watches: { watchCount: f.watchers?.length ?? 0, isWatching: false },
      customfield_10016: f.points ?? null,
      customfield_10030: f.effort ?? null,
      customfield_10020: f.sprints ?? null,
      customfield_10019: f.rank ?? null,
      __watchers: f.watchers ?? [],
    },
  };
}

const parentRef = (i) => ({ id: i.id, key: i.key, fields: { summary: i.fields.summary, issuetype: i.fields.issuetype, status: i.fields.status } });
const link = (id, name, dir, other) => ({
  id: String(id),
  type: { id: "x", name, inward: name === "Blocks" ? "is blocked by" : name === "Problem/Incident" ? "is caused by" : "relates to", outward: name === "Blocks" ? "blocks" : name === "Problem/Incident" ? "causes" : "relates to" },
  ...(dir === "out" ? { outwardIssue: { id: other.id, key: other.key } } : { inwardIssue: { id: other.id, key: other.key } }),
});
const att = (id, filename, size, mimeType, author = U.maya) => ({ id: String(id), filename, size, mimeType, content: `${ORIGIN}/rest/api/3/attachment/content/${id}`, created: "2025-01-05T12:00:00.000+0000", author });
const comment = (id, author, text, created) => ({ id: String(id), author, body: doc(p(t(text))), created, updated: created });

function reset() {
  stats = { requests: 0, byPath: {}, throttledOnce: false };
  throttled = false;
  const epic = issue(10001, "ACME-1", "epic", "Onboarding course", { status: ST.prog, rank: "0|i0000a:" });
  const story = issue(10002, "ACME-2", "story", "Storyboard module 1", {
    status: ST.review, priority: { id: "2", name: "High" }, points: 5, assignee: U.maya, reporter: U.pat, description: RICH,
    parent: parentRef(epic), sprints: [SPRINTS.s0, SPRINTS.s1], rank: "0|i0000c:", watchers: [U.jordan, U.pat],
    attachment: [att(20001, "storyboard.pdf", 1234, "application/pdf"), att(20002, "huge-video.mp4", 200 * 1024 * 1024, "video/mp4"), att(20003, "evil.png", 42, "image/png", U.pat)],
  });
  const bug = issue(10003, "ACME-3", "bug", "Broken link in module 2", {
    priority: { id: "1", name: "Highest" }, labels: ["qa"], components: [{ name: "Onboarding" }], fixVersions: [{ name: "2.1" }], duedate: "2025-02-14", assignee: U.jordan,
    sprints: [SPRINTS.s1], rank: "0|i0000b:",
  });
  const task4 = issue(10004, "ACME-4", "task", "Fix the quiz scoring", { status: ST.qa, assignee: U.priya, sprints: [SPRINTS.s2], rank: "0|i0000d:" });
  const done5 = issue(10005, "ACME-5", "story", "Kick-off workshop", { status: ST.done, points: 3, sprints: [SPRINTS.s0], parent: parentRef(epic), rank: "0|i0000e:" });
  const sub6 = issue(10006, "ACME-6", "sub", "Write narration", { status: ST.done, parent: parentRef(story), assignee: U.maya });
  const sub7 = issue(10007, "ACME-7", "sub", "Record VO", { parent: parentRef(story), assignee: U.jordan });
  const spike = issue(10008, "ACME-8", "spike", "Spike: LMS reporting", { priority: { id: "9", name: "Minor" }, rank: "0|i0000f:" });
  const fillers = [];
  for (let n = 9; n <= 24; n++) {
    // Jira's rank runs the other way from the keys, so the backlog order is visibly Jira's.
    fillers.push(issue(10000 + n, `ACME-${n}`, "task", `Task ${n}`, { priority: null, rank: `0|i00${String(99 - n).padStart(2, "0")}z:` }));
  }
  const webEpic = issue(11001, "WEB-1", "epic", "Website refresh", { status: ST.todo });
  const web2 = issue(11002, "WEB-2", "story", "New landing page", { parent: parentRef(webEpic), assignee: U.pat, points: 8 });
  // Links appear on both issues, as in Jira.
  bug.fields.issuelinks.push(link(30001, "Blocks", "out", task4));
  task4.fields.issuelinks.push(link(30001, "Blocks", "in", bug));
  task4.fields.issuelinks.push(link(30002, "Relates", "out", web2));
  web2.fields.issuelinks.push(link(30002, "Relates", "in", task4));
  task4.fields.issuelinks.push(link(30003, "Problem/Incident", "out", done5));
  done5.fields.issuelinks.push(link(30003, "Problem/Incident", "in", task4));

  const ops = issue(12001, "OPS-1", "task", "Rotate the on-call schedule", {});
  issues = [epic, story, bug, task4, done5, sub6, sub7, spike, ...fillers, webEpic, web2, ops];
  comments = {
    "10002": [comment(40001, U.maya, "Looks good — one note on scene 2.", "2025-01-06T09:00:00.000+0000"), comment(40002, U.pat, "Client wants a softer tone.", "2025-01-07T09:00:00.000+0000")],
    // More comments than Jira embeds in the search result (it shows 20 there).
    "10003": Array.from({ length: 25 }, (_, k) => comment(41000 + k, k % 2 ? U.jordan : U.priya, `Repro note ${k + 1}`, `2025-01-${String(10 + (k % 18)).padStart(2, "0")}T08:00:00.000+0000`)),
  };
  files = {
    "20001": { bytes: Buffer.from("%PDF-1.4 mock storyboard\n"), mime: "application/pdf", redirect: `http://127.0.0.1:${MEDIA_PORT}/file/20001` },
    "20002": { bytes: Buffer.alloc(16), mime: "video/mp4", redirect: `http://127.0.0.1:${MEDIA_PORT}/file/20002` },
    // Must be refused: a redirect to an internal address.
    "20003": { bytes: Buffer.from("x"), mime: "image/png", redirect: "http://169.254.169.254/latest/meta-data" },
  };
}
reset();

function mutate(step) {
  if (step !== "rerun") return false;
  const byKey = (k) => issues.find((i) => i.key === k);
  byKey("ACME-2").fields.summary = "Storyboard module 1 (v2)";
  byKey("ACME-3").fields.priority = { id: "4", name: "Low" }; // changed in Tavoro too: Tavoro's value should stay
  comments["10002"].push(comment(40003, U.maya, "Approved for build.", "2025-01-12T09:00:00.000+0000"));
  issues.splice(issues.findIndex((i) => i.key === "WEB-1"), 0, issue(10025, "ACME-25", "task", "Translate captions", { rank: "0|i00000:" }));
  return true;
}

// ── JQL (just what the importer sends) ──
function runJql(jql) {
  const m = /project\s*=\s*"?([A-Z0-9]+)"?/i.exec(jql);
  let list = issues.filter((i) => !m || i.key.startsWith(`${m[1].toUpperCase()}-`));
  if (/issuetype not in subTaskIssueTypes\(\)/i.test(jql)) list = list.filter((i) => !i.fields.issuetype.subtask);
  else if (/issuetype in subTaskIssueTypes\(\)/i.test(jql)) list = list.filter((i) => i.fields.issuetype.subtask);
  return list.sort((a, b) => Number(a.key.split("-")[1]) - Number(b.key.split("-")[1]));
}

function shape(i, fields, origin) {
  const all = !fields || fields.includes("*all") || fields.includes("*navigable");
  const out = { id: i.id, key: i.key, self: `${ORIGIN}/rest/api/3/issue/${i.id}`, fields: {} };
  for (const [k, v] of Object.entries(i.fields)) {
    if (k.startsWith("__")) continue;
    if (all || fields.includes(k)) out.fields[k] = k === "attachment" ? v.map((a) => ({ ...a, content: a.content.replace(ORIGIN, origin) })) : v;
  }
  if (all || fields.includes("comment")) {
    const cs = comments[i.id] ?? [];
    out.fields.comment = { comments: cs.slice(0, 20), maxResults: 20, total: cs.length, startAt: 0 };
  }
  return out;
}

// ── HTTP ──
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : {};
}

const api = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const path = url.pathname;
  if (path.startsWith("/__mock/")) {
    if (path === "/__mock/reset") {
      reset();
      return send(res, 200, { ok: true });
    }
    if (path === "/__mock/mutate") return send(res, 200, { ok: mutate((await readBody(req)).step) });
    if (path === "/__mock/stats") return send(res, 200, stats);
    return send(res, 404, {});
  }
  stats.requests++;
  const bucket = path.replace(/\d+/g, ":n");
  stats.byPath[bucket] = (stats.byPath[bucket] ?? 0) + 1;
  if (req.headers.authorization !== AUTH) return send(res, 401, { errorMessages: ["Client must be authenticated to access this resource."] });

  try {
    if (path === "/rest/api/3/myself") return send(res, 200, U.admin);
    if (path === "/_edge/tenant_info") return send(res, 200, { cloudId: "mock-cloud-1" });
    if (path === "/rest/api/3/project/search") {
      const all = [
        { id: "100", key: "ACME", name: "Acme Onboarding", projectTypeKey: "software", style: "classic" },
        { id: "101", key: "WEB", name: "Website", projectTypeKey: "software", style: "next-gen" },
        { id: "102", key: "OPS", name: "Operations", projectTypeKey: "software", style: "classic" },
      ];
      const startAt = Number(url.searchParams.get("startAt") ?? 0);
      const max = Math.min(2, Number(url.searchParams.get("maxResults") ?? 50)); // page it, like Jira does
      const values = all.slice(startAt, startAt + max);
      return send(res, 200, { startAt, maxResults: max, total: all.length, isLast: startAt + values.length >= all.length, values });
    }
    if (path === "/rest/api/3/field") return send(res, 200, FIELDS);
    let m;
    if ((m = /^\/rest\/api\/3\/project\/([A-Z0-9]+)\/statuses$/.exec(path))) {
      const statuses = m[1] === "ACME" ? [ST.todo, ST.prog, ST.review, ST.qa, ST.done] : [ST.todo, ST.prog, ST.done];
      const types = m[1] === "ACME" ? [TYPES.epic, TYPES.story, TYPES.task, TYPES.bug, TYPES.sub, TYPES.spike] : [TYPES.epic, TYPES.story, TYPES.task];
      return send(res, 200, types.map((ty) => ({ id: ty.id, name: ty.name, subtask: ty.subtask, statuses })));
    }
    if (path === "/rest/api/3/search/approximate-count" && req.method === "POST") {
      const body = await readBody(req);
      return send(res, 200, { count: runJql(body.jql).length });
    }
    if (path === "/rest/api/3/search/jql" && req.method === "POST") {
      const body = await readBody(req);
      // One 429 for the WEB project, to check the client waits and retries.
      if (/project\s*=\s*"?WEB/i.test(body.jql) && !throttled) {
        throttled = true;
        stats.throttledOnce = true;
        return send(res, 429, { errorMessages: ["Rate limit exceeded."] }, { "Retry-After": "1" });
      }
      const list = runJql(body.jql);
      const start = body.nextPageToken ? Number(Buffer.from(body.nextPageToken, "base64url").toString()) : 0;
      const max = Math.min(PAGE_CAP, Number(body.maxResults ?? 50));
      const page = list.slice(start, start + max).map((i) => shape(i, body.fields, `http://${req.headers.host}`));
      const next = start + max < list.length ? Buffer.from(String(start + max)).toString("base64url") : undefined;
      return send(res, 200, { issues: page, ...(next ? { nextPageToken: next } : {}), isLast: !next });
    }
    if ((m = /^\/rest\/api\/3\/issue\/(\d+)\/comment$/.exec(path))) {
      const cs = comments[m[1]] ?? [];
      const startAt = Number(url.searchParams.get("startAt") ?? 0);
      const max = Math.min(PAGE_CAP, Number(url.searchParams.get("maxResults") ?? 50));
      return send(res, 200, { startAt, maxResults: max, total: cs.length, comments: cs.slice(startAt, startAt + max) });
    }
    if ((m = /^\/rest\/api\/3\/issue\/(\d+)\/watchers$/.exec(path))) {
      const i = issues.find((x) => x.id === m[1]);
      if (!i) return send(res, 404, { errorMessages: ["Issue does not exist"] });
      return send(res, 200, { isWatching: false, watchCount: i.fields.__watchers.length, watchers: i.fields.__watchers });
    }
    if ((m = /^\/rest\/api\/3\/attachment\/content\/(\d+)$/.exec(path))) {
      const f = files[m[1]];
      if (!f) return send(res, 404, {});
      res.writeHead(303, { Location: f.redirect });
      return res.end();
    }
    if (path === "/rest/agile/1.0/board") {
      const key = url.searchParams.get("projectKeyOrId");
      const values = key === "ACME" ? [{ id: 7, name: "ACME board", type: "scrum" }] : [];
      return send(res, 200, { maxResults: 50, startAt: 0, total: values.length, isLast: true, values });
    }
    if (path === "/rest/agile/1.0/board/7/configuration") {
      return send(res, 200, {
        id: 7,
        name: "ACME board",
        columnConfig: {
          columns: [
            { name: "Backlog", statuses: [{ id: ST.todo.id }] },
            { name: "Doing", statuses: [{ id: ST.prog.id }] },
            { name: "Review & QA", statuses: [{ id: ST.review.id }, { id: ST.qa.id }] },
            { name: "Shipped", statuses: [{ id: ST.done.id }] },
          ],
        },
      });
    }
    return send(res, 404, { errorMessages: [`No mock for ${req.method} ${path}`] });
  } catch (e) {
    return send(res, 500, { errorMessages: [String(e)] });
  }
});

// The "media" host attachments redirect to. It wants no Jira credentials.
const media = http.createServer((req, res) => {
  const m = /^\/file\/(\d+)$/.exec(new URL(req.url, "http://x").pathname);
  const f = m && files[m[1]];
  if (!f) {
    res.writeHead(404);
    return res.end();
  }
  if (req.headers.authorization) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    return res.end("credentials leaked to the media host");
  }
  res.writeHead(200, { "Content-Type": f.mime, "Content-Length": f.bytes.length });
  res.end(f.bytes);
});

api.listen(PORT, () => console.log(`[jira-mock] API on ${ORIGIN}`));
media.listen(MEDIA_PORT, () => console.log(`[jira-mock] media on http://127.0.0.1:${MEDIA_PORT}`));
