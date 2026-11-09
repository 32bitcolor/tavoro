"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, CloudDownload, Loader2, X } from "lucide-react";

import {
  cancelJiraImport,
  chooseJiraProjects,
  connectJira,
  getJiraImport,
  saveJiraMapping,
  startJiraImport,
} from "@/app/actions/jira-import";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ImportMapping, ImportProject, ImportReport, ScanResult } from "@/lib/jira/map";
import { cn } from "@/lib/utils";

// Settings → Import → Jira (docs/JIRA-PARITY.md, phase 5): connect, pick projects,
// check the dry run and mapping, import, read the report.

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  connected: { label: "Choosing projects", tone: "neutral" },
  scanning: { label: "Scanning", tone: "info" },
  ready: { label: "Ready to import", tone: "info" },
  importing: { label: "Importing", tone: "info" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

function Badge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as StatusTone };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

function bytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
  return `${Math.round((n / 1024 / 1024 / 1024) * 10) / 10} GB`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// ── Step 1: connect ──

export function JiraConnect({ defaultSite, defaultEmail }: { defaultSite: string; defaultEmail: string }) {
  const router = useRouter();
  const [site, setSite] = useState(defaultSite);
  const [email, setEmail] = useState(defaultEmail);
  const [token, setToken] = useState("");
  const [error, setError] = useState<{ text: string; importId?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await connectJira({ site, email, token });
    if ("error" in res && res.error) {
      setError({ text: res.error, importId: "importId" in res ? res.importId : undefined });
      setBusy(false);
      return;
    }
    if ("importId" in res && res.importId) router.push(`/settings/import/${res.importId}`);
  }

  return (
    <section className="rounded-xl border border-border p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
          <CloudDownload className="size-4.5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Import from Jira</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bring Jira Cloud projects over as boards: issues with their keys, types, priorities, points, epics, sub-tasks, sprints,
            links, comments, attachments and watchers. You&rsquo;ll see what will come over before anything is imported, and you can
            run it again later to pick up changes.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="jira-site">Jira site</Label>
          <Input id="jira-site" value={site} onChange={(e) => setSite(e.target.value)} placeholder="acme.atlassian.net" autoComplete="url" required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="jira-email">Atlassian account email</Label>
            <Input id="jira-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="jira-token">API token</Label>
            <Input id="jira-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Make a token at <span className="font-medium text-foreground">id.atlassian.com → Security → API tokens</span>. Tavoro keeps it
          (encrypted) only while the import runs, then deletes it. The account needs to be able to browse the projects you import.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive-ink">
            {error.text}{" "}
            {error.importId && (
              <Link href={`/settings/import/${error.importId}`} className="underline underline-offset-2">
                Open the running import
              </Link>
            )}
          </p>
        )}
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function JiraRunList({ runs }: { runs: { id: string; site: string; status: string; projects: string[]; createdAt: string; by: string | null }[] }) {
  if (runs.length === 0) return null;
  return (
    <section aria-labelledby="jira-runs" className="flex flex-col gap-2">
      <h2 id="jira-runs" className="text-sm font-semibold">
        Imports
      </h2>
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {runs.map((r) => (
          <li key={r.id}>
            <Link href={`/settings/import/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-hover">
              <span className="font-medium">{r.projects.length ? r.projects.join(", ") : "No projects yet"}</span>
              <span className="text-muted-foreground">{r.site}</span>
              <Badge status={r.status} />
              <span className="ml-auto text-xs text-muted-foreground">
                <span suppressHydrationWarning>{new Date(r.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                {r.by && <> · {r.by}</>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── The run ──

type Run = NonNullable<Awaited<ReturnType<typeof getJiraImport>>>;
type Defaults = {
  projects: { id: string; key: string; name: string; selected: boolean; target: ImportProject["target"]; reusesBoard: string | null }[];
  boards: { id: string; name: string; prefix: string | null }[];
};
type StatusOpt = { id: string; name: string; category: string };
type Member = { id: string; name: string | null; email: string };

export function JiraImportRun({ initial, defaults, statuses, members }: { initial: Run; defaults: Defaults; statuses: StatusOpt[]; members: Member[] }) {
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const [editProjects, setEditProjects] = useState(false);
  const working = run.status === "scanning" || run.status === "importing";

  // Poll while the worker has it.
  useEffect(() => {
    if (!working) return;
    let live = true;
    const t = setInterval(async () => {
      const next = await getJiraImport(run.id);
      if (!live || !next) return;
      setRun(next);
      if (next.status !== run.status) router.refresh();
    }, 1500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [working, run.id, run.status, router]);

  async function cancel() {
    await cancelJiraImport(run.id);
    const next = await getJiraImport(run.id);
    if (next) setRun(next);
  }

  const picking = run.status === "connected" || (editProjects && run.status === "ready");
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/settings/import" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          Import
        </Link>
        <span className="text-muted-foreground" aria-hidden="true">
          /
        </span>
        <h2 className="text-base font-semibold">Jira · {run.site}</h2>
        <Badge status={run.status} />
        <span className="flex-1" />
        {["connected", "scanning", "ready", "importing"].includes(run.status) && (
          <Button variant="ghost" size="sm" onClick={cancel} className="text-muted-foreground">
            <X className="size-3.5" aria-hidden="true" />
            Cancel import
          </Button>
        )}
      </div>

      {picking && run.hasToken && (
        <ProjectPicker
          importId={run.id}
          defaults={defaults}
          onStarted={async () => {
            setEditProjects(false);
            const next = await getJiraImport(run.id);
            if (next) setRun(next);
          }}
        />
      )}
      {run.status === "scanning" && <ProgressPanel run={run} verb="Scanning" />}
      {run.status === "ready" && !editProjects && run.mapping && (
        <ReadyPanel run={run} statuses={statuses} members={members} onEditProjects={() => setEditProjects(true)} onStarted={(next) => setRun(next)} />
      )}
      {run.status === "importing" && <ProgressPanel run={run} verb="Importing" />}
      {run.status === "done" && run.report && <ReportPanel report={run.report as unknown as ImportReport} />}
      {run.status === "failed" && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="flex items-start gap-2 text-destructive-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {run.error ?? "The import stopped."}
          </p>
          {run.report && <p className="text-muted-foreground">What came over before it stopped is kept. Running the import again picks up where it left off without duplicating anything.</p>}
          <div>
            <Link href="/settings/import" className="text-sm font-medium underline underline-offset-2">
              Start again
            </Link>
          </div>
        </div>
      )}
      {run.status === "cancelled" && (
        <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
          This import was cancelled{run.report ? "; what it had already brought over is kept" : ""}.{" "}
          <Link href="/settings/import" className="font-medium text-foreground underline underline-offset-2">
            Start again
          </Link>
        </p>
      )}
      {run.status === "done" && run.report && <ReportBody report={run.report as unknown as ImportReport} />}
    </div>
  );
}

function ProjectPicker({ importId, defaults, onStarted }: { importId: string; defaults: Defaults; onStarted: () => void }) {
  const [rows, setRows] = useState(defaults.projects);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const patch = (id: string, p: Partial<Defaults["projects"][number]>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const chosen = rows.filter((r) => r.selected);

  async function scan() {
    setBusy(true);
    setError(null);
    const res = await chooseJiraProjects(
      importId,
      chosen.map((r) => ({ id: r.id, key: r.key, name: r.name, target: r.target })),
    );
    setBusy(false);
    if ("error" in res && res.error) setError(res.error);
    else onStarted();
  }

  return (
    <section aria-labelledby="pick-projects" className="flex flex-col gap-3 rounded-xl border border-border p-5">
      <div>
        <h3 id="pick-projects" className="text-sm font-semibold">
          Choose projects
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Each project becomes a board. Keep its Jira key as the board&rsquo;s prefix so <span className="font-mono text-xs">PROJ-123</span> stays{" "}
          <span className="font-mono text-xs">PROJ-123</span>.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 px-3 py-2.5">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={r.selected} onChange={(e) => patch(r.id, { selected: e.target.checked })} className="size-4 accent-[var(--accent)]" />
              <span className="font-mono text-xs text-muted-foreground">{r.key}</span>
              <span className="font-medium">{r.name}</span>
            </label>
            {r.selected && (
              <div className="flex flex-wrap items-center gap-2 pl-6">
                <Select
                  aria-label={`Where ${r.key} goes`}
                  value={r.target.kind === "board" ? r.target.boardId : "new"}
                  onChange={(e) =>
                    patch(r.id, {
                      target: e.target.value === "new" ? { kind: "new", name: r.name, prefix: r.key.toUpperCase().slice(0, 8) } : { kind: "board", boardId: e.target.value },
                    })
                  }
                  className="h-8 w-auto py-1 text-sm"
                >
                  <option value="new">{r.reusesBoard ? `Its board from the last import (${r.reusesBoard})` : "A new board"}</option>
                  {defaults.boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      Existing board: {b.name}
                      {b.prefix ? ` (${b.prefix})` : ""}
                    </option>
                  ))}
                </Select>
                {r.target.kind === "new" && !r.reusesBoard && (
                  <>
                    <Input
                      aria-label={`Board name for ${r.key}`}
                      value={r.target.name}
                      onChange={(e) => patch(r.id, { target: { ...(r.target as { kind: "new"; name: string; prefix: string }), name: e.target.value } })}
                      className="h-8 w-56 text-sm"
                    />
                    <Input
                      aria-label={`Key prefix for ${r.key}`}
                      value={r.target.prefix}
                      maxLength={8}
                      onChange={(e) => patch(r.id, { target: { ...(r.target as { kind: "new"; name: string; prefix: string }), prefix: e.target.value.toUpperCase() } })}
                      className="h-8 w-24 font-mono text-sm"
                    />
                  </>
                )}
                {r.target.kind === "board" && <span className="text-xs text-muted-foreground">Cards get that board&rsquo;s keys; the report lists old and new keys.</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-destructive-ink">
          {error}
        </p>
      )}
      <div>
        <Button onClick={scan} disabled={busy || chosen.length === 0}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Scan {chosen.length ? plural(chosen.length, "project") : "projects"}
        </Button>
        <p className="mt-1.5 text-xs text-muted-foreground">Scanning only reads from Jira. Nothing is imported until you confirm.</p>
      </div>
    </section>
  );
}

function ProgressPanel({ run, verb }: { run: Run; verb: string }) {
  const p = (run.progress ?? {}) as { phase?: string; projectIndex?: number; seen?: number; total?: number | null };
  const project = run.projects[p.projectIndex ?? 0];
  const pct = p.total ? Math.min(100, Math.round(((p.seen ?? 0) / p.total) * 100)) : null;
  const phase =
    p.phase === "relations" ? "Linking epics and issues…" : p.phase === "rank" ? "Ordering the backlog…" : project ? `${verb} ${project.key}${p.total ? ` — ${(p.seen ?? 0).toLocaleString()} of ${p.total.toLocaleString()} issues` : p.seen ? ` — ${p.seen.toLocaleString()} issues` : "…"}` : `${verb}…`;
  const counts = (run.report as unknown as ImportReport | null)?.counts;
  return (
    <section aria-live="polite" className="flex flex-col gap-3 rounded-xl border border-border p-5">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="size-4 animate-spin text-accent" aria-hidden="true" />
        {phase}
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-label="Progress">
        <div className={cn("h-full bg-accent transition-all", pct == null && "w-1/3 animate-pulse")} style={pct != null ? { width: `${pct}%` } : undefined} />
      </div>
      {counts && (
        <p className="text-xs text-muted-foreground">
          So far: {plural(counts.cardsCreated, "card")} created, {plural(counts.cardsUpdated, "card")} updated, {plural(counts.comments, "comment")},{" "}
          {plural(counts.attachments, "attachment")}.
        </p>
      )}
      <p className="text-xs text-muted-foreground">This runs in the background. You can leave this page; come back to see the report.</p>
    </section>
  );
}

function ReadyPanel({
  run,
  statuses,
  members,
  onEditProjects,
  onStarted,
}: {
  run: Run;
  statuses: StatusOpt[];
  members: Member[];
  onEditProjects: () => void;
  onStarted: (r: Run) => void;
}) {
  const scan = run.scan as unknown as ScanResult;
  const [mapping, setMapping] = useState<ImportMapping>(run.mapping!);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unmatched = mapping.users.filter((u) => !u.memberId).length;

  async function go() {
    setBusy(true);
    setError(null);
    const saved = await saveJiraMapping(run.id, {
      statuses: mapping.statuses.map((s) => ({ jiraId: s.jiraId, statusId: s.statusId })),
      users: mapping.users.map((u) => ({ accountId: u.accountId, memberId: u.memberId })),
      types: mapping.types.map((t) => ({ jiraName: t.jiraName, to: t.to })),
      points: mapping.fields.points,
      componentsAsLabels: mapping.componentsAsLabels,
    });
    if ("error" in saved && saved.error) {
      setError(saved.error);
      setBusy(false);
      return;
    }
    const res = await startJiraImport(run.id);
    setBusy(false);
    if ("error" in res && res.error) {
      setError(res.error);
      return;
    }
    const next = await getJiraImport(run.id);
    if (next) onStarted(next);
  }

  const stat = (n: number, label: string) => (
    <div className="rounded-lg bg-surface-muted px-3 py-2">
      <div className="text-lg font-semibold tabular-nums">{n.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );

  return (
    <>
      <section aria-labelledby="dry-run" className="flex flex-col gap-3 rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="dry-run" className="text-sm font-semibold">
            What will come over
          </h3>
          <span className="text-xs text-muted-foreground">{run.projects.map((p) => p.key).join(", ")}</span>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onEditProjects}>
            Change projects
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stat(scan.issues, "issues")}
          {stat(scan.projects.reduce((n, p) => n + p.subtasks, 0), "of them sub-tasks")}
          {stat(scan.projects.reduce((n, p) => n + p.epics, 0), "epics")}
          {stat(scan.comments, "comments")}
          {stat(scan.attachments, `attachments · ${bytes(scan.attachmentBytes)}`)}
          {stat(scan.sprints, "sprints")}
          {stat(scan.links, "links")}
          {stat(scan.labels, "labels")}
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {scan.attachmentsTooBig > 0 && <Warn>{plural(scan.attachmentsTooBig, "attachment")} over 95 MB won&rsquo;t come over.</Warn>}
          {scan.otherLinkTypes.length > 0 && <Warn>Links of type {scan.otherLinkTypes.join(", ")} come over as &ldquo;relates to&rdquo;.</Warn>}
          {unmatched > 0 && (
            <Warn>
              {plural(unmatched, "person", "people")} in Jira {unmatched === 1 ? "isn’t" : "aren’t"} a member here. Their comments come over under your name with
              theirs shown; cards assigned to them come over unassigned, with a note.
            </Warn>
          )}
        </ul>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Not imported</summary>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {scan.notImported.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      </section>

      <section aria-labelledby="mapping" className="flex flex-col gap-5 rounded-xl border border-border p-5">
        <div>
          <h3 id="mapping" className="text-sm font-semibold">
            Mapping
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">Filled in by name and email. Change anything that&rsquo;s wrong.</p>
        </div>

        <MapTable title="Statuses" left="In Jira" right="In Tavoro">
          {mapping.statuses.map((s, i) => (
            <MapRow key={s.jiraId} left={<>{s.jiraName} <span className="text-xs text-muted-foreground">({CAT[s.category]})</span></>}>
              <Select
                aria-label={`Tavoro status for ${s.jiraName}`}
                value={s.statusId ?? ""}
                onChange={(e) => setMapping((m) => ({ ...m, statuses: m.statuses.map((x, j) => (j === i ? { ...x, statusId: e.target.value || null } : x)) }))}
                className="h-8 py-1 text-sm"
              >
                <option value="">Create “{s.jiraName}” ({CAT[s.category]})</option>
                {statuses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </MapRow>
          ))}
        </MapTable>

        <MapTable title="People" left="In Jira" right="Member">
          {mapping.users.map((u, i) => (
            <MapRow
              key={u.accountId}
              left={
                <>
                  {u.displayName}
                  {u.email && <span className="block text-xs text-muted-foreground">{u.email}</span>}
                </>
              }
            >
              <Select
                aria-label={`Member for ${u.displayName}`}
                value={u.memberId ?? ""}
                onChange={(e) => setMapping((m) => ({ ...m, users: m.users.map((x, j) => (j === i ? { ...x, memberId: e.target.value || null, how: e.target.value ? "manual" : null } : x)) }))}
                className="h-8 py-1 text-sm"
              >
                <option value="">Not a member (keep their name)</option>
                {members.map((mb) => (
                  <option key={mb.id} value={mb.id}>
                    {mb.name ?? mb.email}
                  </option>
                ))}
              </Select>
            </MapRow>
          ))}
          {mapping.users.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No people found.</p>}
        </MapTable>

        <MapTable title="Issue types" left="In Jira" right="Card type">
          {mapping.types.map((t, i) => (
            <MapRow key={t.jiraName} left={t.jiraName}>
              {t.subtask ? (
                <span className="text-sm text-muted-foreground">Subtask</span>
              ) : (
                <Select
                  aria-label={`Card type for ${t.jiraName}`}
                  value={t.to}
                  onChange={(e) => setMapping((m) => ({ ...m, types: m.types.map((x, j) => (j === i ? { ...x, to: e.target.value as typeof x.to } : x)) }))}
                  className="h-8 py-1 text-sm"
                >
                  <option value="task">Task</option>
                  <option value="story">Story</option>
                  <option value="bug">Bug</option>
                  <option value="epic">Epic</option>
                </Select>
              )}
            </MapRow>
          ))}
        </MapTable>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="points-field">Story points field</Label>
            <Select
              id="points-field"
              value={mapping.fields.points ?? ""}
              onChange={(e) => setMapping((m) => ({ ...m, fields: { ...m.fields, points: e.target.value || null } }))}
            >
              <option value="">Don&rsquo;t import estimates</option>
              {scan.numberFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-start gap-2 self-end text-sm">
            <input
              type="checkbox"
              checked={mapping.componentsAsLabels}
              onChange={(e) => setMapping((m) => ({ ...m, componentsAsLabels: e.target.checked }))}
              className="mt-0.5 size-4 accent-[var(--accent)]"
            />
            <span>
              Components and fix versions as labels
              <span className="block text-xs text-muted-foreground">“component: Onboarding”, “version: 2.1”</span>
            </span>
          </label>
        </div>
      </section>

      <div className="flex flex-col gap-2">
        {error && (
          <p role="alert" className="text-sm text-destructive-ink">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={go} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Import {plural(scan.issues, "issue")}
          </Button>
          <span className="text-xs text-muted-foreground">
            Consider a{" "}
            <Link href="/settings/backup" className="underline underline-offset-2">
              backup
            </Link>{" "}
            first. Nobody is emailed by an import.
          </span>
        </div>
      </div>
    </>
  );
}

const CAT: Record<string, string> = { todo: "to do", active: "in progress", done: "done" };

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-muted-foreground">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-ink" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function MapTable({ title, left, right, children }: { title: string; left: string; right: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase">{title}</h4>
      <div role="table" aria-label={title} className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
        <div role="row" className="hidden grid-cols-2 gap-3 bg-surface-muted px-3 py-1.5 text-xs font-medium text-muted-foreground sm:grid">
          <span role="columnheader">{left}</span>
          <span role="columnheader">{right}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function MapRow({ left, children }: { left: React.ReactNode; children: React.ReactNode }) {
  return (
    <div role="row" className="grid gap-1.5 px-3 py-2 sm:grid-cols-2 sm:items-center sm:gap-3">
      <span role="cell" className="text-sm">
        {left}
      </span>
      <span role="cell">{children}</span>
    </div>
  );
}

function ReportPanel({ report }: { report: ImportReport }) {
  const c = report.counts;
  return (
    <section aria-labelledby="report" className="flex flex-col gap-3 rounded-xl border border-border p-5">
      <h3 id="report" className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2 className="size-4 text-success-ink" aria-hidden="true" />
        Import finished
      </h3>
      <p className="text-sm">
        {plural(c.cardsCreated, "card")} created ({plural(c.subtasks, "subtask")}), {plural(c.cardsUpdated, "card")} updated, {plural(c.comments, "comment")},{" "}
        {plural(c.attachments, "attachment")}, {plural(c.sprints, "sprint")}, {plural(c.links, "link")}, {plural(c.watchers, "watcher")}.
        {c.statusesCreated > 0 && <> {plural(c.statusesCreated, "status", "statuses")} and</>}
        {c.labelsCreated > 0 && <> {plural(c.labelsCreated, "label")} created.</>}
      </p>
      {report.keptLocal > 0 && (
        <p className="text-sm text-muted-foreground">
          {plural(report.keptLocal, "field")} changed in Tavoro since the last import {report.keptLocal === 1 ? "was" : "were"} left as {report.keptLocal === 1 ? "it was" : "they were"}.
        </p>
      )}
      <ul className="flex flex-wrap gap-2">
        {report.boards.map((b) => (
          <li key={b.boardId}>
            <Link href={`/boards/${b.boardId}`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-hover">
              {b.name}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </li>
        ))}
        <li>
          <Link href="/sprints/backlog" className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-hover hover:text-foreground">
            Backlog
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </li>
      </ul>
    </section>
  );
}

function ReportBody({ report }: { report: ImportReport }) {
  return (
    <>
      {report.rekeyed.length > 0 && (
        <details className="rounded-xl border border-border p-4 text-sm">
          <summary className="cursor-pointer font-medium">{plural(report.rekeyed.length, "card")} got a new key</summary>
          <p className="mt-1 text-xs text-muted-foreground">Searching for the old Jira key still finds the card.</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 font-mono text-xs sm:grid-cols-3">
            {report.rekeyed.slice(0, 300).map((r) => (
              <li key={r.jira}>
                {r.jira} → {r.tavoro}
              </li>
            ))}
          </ul>
        </details>
      )}
      {report.skipped.length > 0 && (
        <details className="rounded-xl border border-border p-4 text-sm">
          <summary className="cursor-pointer font-medium">{plural(report.skipped.length, "thing")} didn&rsquo;t come over</summary>
          <ul className="mt-2 flex flex-col gap-0.5 text-xs">
            {report.skipped.slice(0, 300).map((s, i) => (
              <li key={i}>
                {s.key && <span className="font-mono text-muted-foreground">{s.key} </span>}
                {s.what}: {s.why}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
