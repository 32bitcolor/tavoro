// A small Jira Cloud REST client (API v3 + Agile 1.0) for the importer. Shared by the
// app (connect, list projects) and the worker (scan, import), so it isn't server-only.
//
// Safety (docs/JIRA-PARITY.md "Limits and safety"):
// - the site must be *.atlassian.net, or a host listed in JIRA_ALLOWED_HOSTS (for a
//   test mock or an approved proxy) — nothing else, so it can't reach internal hosts;
// - redirects are refused, except an attachment download hopping to Atlassian's media
//   hosts, which gets no credentials;
// - 429 / 503 are retried with backoff, honouring Retry-After.

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

const ATLASSIAN_SITE = /^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/i;
const MEDIA_HOST = /(^|\.)(atlassian\.net|atlassian\.com|atl-paas\.net)$/i;

function allowedHosts(): string[] {
  return (process.env.JIRA_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** "https://acme.atlassian.net/jira/…" or "acme" → the site's origin, or an error. */
export function normalizeSite(input: string): { origin: string; host: string } | { error: string } {
  let s = input.trim();
  if (!s) return { error: "Enter your Jira site, like acme.atlassian.net." };
  if (/^[a-z0-9-]+$/i.test(s)) s = `${s}.atlassian.net`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return { error: "That isn’t a site address." };
  }
  const host = url.host.toLowerCase();
  const approved = allowedHosts().includes(host);
  if (!approved && !ATLASSIAN_SITE.test(host)) return { error: "Tavoro imports from Jira Cloud sites (something.atlassian.net)." };
  if (url.protocol !== "https:" && !approved) return { error: "Jira Cloud sites use https." };
  if (url.username || url.password) return { error: "Leave the email and token out of the site address." };
  return { origin: `${url.protocol}//${host}`, host };
}

type Query = Record<string, string | number | boolean | undefined>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class JiraClient {
  private auth: string;
  /** Requests made, for the run's report. */
  requests = 0;

  constructor(
    readonly origin: string,
    email: string,
    token: string,
    private opts: { minGapMs?: number } = {},
  ) {
    this.auth = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  }

  static fromSite(site: string, email: string, token: string) {
    const n = normalizeSite(site);
    if ("error" in n) throw new JiraError(n.error);
    return new JiraClient(n.origin, email, token);
  }

  private last = 0;

  private async send(path: string, init: { method?: string; query?: Query; body?: unknown } = {}): Promise<Response> {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin) throw new JiraError("Refusing a request off the Jira site.");
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      // Pace requests a little; Jira Cloud's limits are per user and per site.
      const gap = (this.opts.minGapMs ?? 50) - (Date.now() - this.last);
      if (gap > 0) await sleep(gap);
      this.last = Date.now();
      this.requests++;
      let res: Response;
      try {
        res = await fetch(url, {
          method: init.method ?? "GET",
          headers: {
            Authorization: this.auth,
            Accept: "application/json",
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          redirect: "manual",
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        if (attempt < 3) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        // -1: a network failure, worth retrying later (unlike a refused token).
        throw new JiraError(`Couldn’t reach ${new URL(this.origin).host}: ${cause?.code ?? cause?.message ?? (e as Error).message}`, -1);
      }
      if ((res.status === 429 || res.status === 503) && attempt < 6) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 120) * 1000 : Math.min(60_000, 1000 * 2 ** attempt + Math.random() * 500));
        continue;
      }
      return res;
    }
  }

  async json<T>(path: string, init: { method?: string; query?: Query; body?: unknown } = {}): Promise<T> {
    const res = await this.send(path, init);
    if (res.status >= 300 && res.status < 400) throw new JiraError("Jira redirected the request; check the site address.", res.status);
    if (res.status === 401) throw new JiraError("Jira didn’t accept that email and API token.", 401);
    if (res.status === 403) throw new JiraError("That Jira account doesn’t have permission for this.", 403);
    if (res.status === 404) throw new JiraError(`Not found in Jira: ${path}`, 404);
    if (!res.ok) throw new JiraError(`Jira answered ${res.status} for ${path}.`, res.status);
    return (await res.json()) as T;
  }

  /**
   * An attachment's bytes. Jira answers with a redirect to its media service; follow
   * that only to Atlassian hosts (or an approved one), without our credentials.
   */
  async download(path: string, maxBytes: number): Promise<{ bytes: Uint8Array; mimeType: string } | { skipped: string }> {
    if (new URL(path, this.origin).origin !== this.origin) return { skipped: "not on the Jira site" };
    let res = await this.send(path);
    for (let hop = 0; res.status >= 300 && res.status < 400 && hop < 3; hop++) {
      const loc = res.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, this.origin);
      const host = next.host.toLowerCase();
      if (next.origin === this.origin) {
        res = await this.send(next.pathname + next.search);
        continue;
      }
      if (next.protocol !== "https:" && !allowedHosts().includes(host)) return { skipped: "redirected off https" };
      if (!MEDIA_HOST.test(next.hostname) && !allowedHosts().includes(host)) return { skipped: `redirected to ${host}` };
      this.requests++;
      res = await fetch(next, { redirect: "manual", signal: AbortSignal.timeout(300_000) });
    }
    if (!res.ok) return { skipped: `download failed (${res.status})` };
    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > maxBytes) return { skipped: "too large" };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return { skipped: "too large" };
    return { bytes: buf, mimeType: res.headers.get("content-type")?.split(";")[0] || "application/octet-stream" };
  }

  // ── Endpoints ──

  myself() {
    return this.json<{ accountId: string; displayName: string; emailAddress?: string }>("/rest/api/3/myself");
  }

  /** The site's cloud id, used in external refs so two sites never collide. */
  async cloudId(): Promise<string> {
    try {
      return (await this.json<{ cloudId: string }>("/_edge/tenant_info")).cloudId;
    } catch {
      return new URL(this.origin).host;
    }
  }

  async projects(): Promise<JiraProject[]> {
    const out: JiraProject[] = [];
    for (let startAt = 0; ; ) {
      const page = await this.json<{ values: JiraProject[]; isLast?: boolean; total?: number }>("/rest/api/3/project/search", {
        query: { startAt, maxResults: 50, orderBy: "key" },
      });
      out.push(...page.values);
      startAt += page.values.length;
      if (page.isLast || page.values.length === 0 || (page.total != null && startAt >= page.total)) return out;
    }
  }

  fields() {
    return this.json<JiraField[]>("/rest/api/3/field");
  }

  projectStatuses(key: string) {
    return this.json<{ id: string; name: string; subtask: boolean; statuses: JiraStatus[] }[]>(`/rest/api/3/project/${encodeURIComponent(key)}/statuses`);
  }

  async approximateCount(jql: string): Promise<number | null> {
    try {
      return (await this.json<{ count: number }>("/rest/api/3/search/approximate-count", { method: "POST", body: { jql } })).count;
    } catch {
      return null;
    }
  }

  /** One page of a JQL search (the enhanced search API, paged by token). */
  search(jql: string, fields: string[], nextPageToken?: string | null, maxResults = 100) {
    return this.json<{ issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean }>("/rest/api/3/search/jql", {
      method: "POST",
      body: { jql, fields, maxResults, ...(nextPageToken ? { nextPageToken } : {}) },
    });
  }

  async comments(issueId: string): Promise<JiraComment[]> {
    const out: JiraComment[] = [];
    for (let startAt = 0; ; ) {
      const page = await this.json<{ comments: JiraComment[]; total: number }>(`/rest/api/3/issue/${encodeURIComponent(issueId)}/comment`, {
        query: { startAt, maxResults: 100, orderBy: "created" },
      });
      out.push(...page.comments);
      startAt += page.comments.length;
      if (page.comments.length === 0 || startAt >= page.total) return out;
    }
  }

  async watchers(issueId: string): Promise<JiraUser[]> {
    return (await this.json<{ watchers: JiraUser[] }>(`/rest/api/3/issue/${encodeURIComponent(issueId)}/watchers`)).watchers ?? [];
  }

  /** The project's Jira board column layout, if it has a board. */
  async boardColumns(projectKey: string): Promise<{ name: string; statusIds: string[] }[] | null> {
    try {
      const boards = await this.json<{ values: { id: number; type: string }[] }>("/rest/agile/1.0/board", { query: { projectKeyOrId: projectKey, maxResults: 10 } });
      const board = boards.values.find((b) => b.type === "scrum") ?? boards.values[0];
      if (!board) return null;
      const conf = await this.json<{ columnConfig?: { columns: { name: string; statuses: { id: string }[] }[] } }>(`/rest/agile/1.0/board/${board.id}/configuration`);
      return conf.columnConfig?.columns.map((c) => ({ name: c.name, statusIds: c.statuses.map((s) => s.id) })) ?? null;
    } catch {
      return null;
    }
  }
}

// ── Response shapes (only the parts the importer reads) ──

export type JiraUser = { accountId: string; displayName: string; emailAddress?: string; active?: boolean };
export type JiraProject = { id: string; key: string; name: string; projectTypeKey?: string; style?: string };
export type JiraField = { id: string; name: string; custom: boolean; schema?: { type?: string; custom?: string; items?: string } };
export type JiraStatus = { id: string; name: string; statusCategory: { key: string; name?: string } };
export type JiraSprint = { id: number; name: string; state: string; goal?: string; startDate?: string; endDate?: string; completeDate?: string; boardId?: number };
export type JiraComment = { id: string; author?: JiraUser; body: unknown; created: string; updated?: string };
export type JiraAttachment = { id: string; filename: string; size: number; mimeType: string; content: string; created?: string; author?: JiraUser };
export type JiraLink = {
  id: string;
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { id: string; key: string };
  outwardIssue?: { id: string; key: string };
};
export type JiraIssue = {
  id: string;
  key: string;
  fields: Record<string, unknown> & {
    summary?: string;
    description?: unknown;
    issuetype?: { id: string; name: string; subtask: boolean; hierarchyLevel?: number };
    status?: JiraStatus;
    priority?: { id: string; name: string } | null;
    labels?: string[];
    duedate?: string | null;
    created?: string;
    updated?: string;
    assignee?: JiraUser | null;
    reporter?: JiraUser | null;
    parent?: { id: string; key: string; fields?: { issuetype?: { name: string; hierarchyLevel?: number } } };
    issuelinks?: JiraLink[];
    comment?: { comments: JiraComment[]; total: number; maxResults?: number };
    attachment?: JiraAttachment[];
    components?: { name: string }[];
    fixVersions?: { name: string }[];
    watches?: { watchCount: number; isWatching?: boolean };
  };
};
