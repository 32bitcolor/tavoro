"use client";

import { useRef, useState, useTransition } from "react";
import { Download, Upload, Archive, RotateCcw, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { backfillWorkspaceCardKeys } from "@/app/actions/boards";

export function BackupPanel({ workspaceName }: { workspaceName: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<{ tone: "info" | "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [backfillPending, startBackfill] = useTransition();
  const [backfillResult, setBackfillResult] = useState<
    { boardName: string; prefix: string; count: number }[] | string | null
  >(null);

  function runBackfill() {
    setBackfillResult(null);
    startBackfill(async () => {
      const res = await backfillWorkspaceCardKeys();
      if ("error" in res && res.error) setBackfillResult(res.error);
      else if ("results" in res && res.results) setBackfillResult(res.results);
    });
  }

  async function restore() {
    if (!file || busy) return;
    if (!confirm("Restore this backup into a NEW workspace? Your current workspace is untouched; you'll be switched into the restored copy.")) return;
    setBusy(true);
    setStatus({ tone: "info", text: "Restoring… large workspaces with media can take a minute." });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/workspace/restore", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setStatus({ tone: "ok", text: "Restored — opening the new workspace…" });
        // A full load on purpose: the session now points at another workspace, and every
        // cached server component belongs to the old one.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/dashboard";
      } else {
        setStatus({ tone: "error", text: data.error || "Restore failed." });
        setBusy(false);
      }
    } catch (e) {
      setStatus({ tone: "error", text: (e as Error).message });
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {/* Backup */}
      <section className="rounded-xl border border-border p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
            <Archive className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-medium">Back up this workspace</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Download a complete, self-contained archive of <strong>{workspaceName}</strong> — every
              board, project, storyboard, and whiteboard, plus members and attachment files.
              Keep it somewhere safe off this server.
            </p>
            <div className="mt-4">
              <Button asChild>
                <a href="/api/workspace/backup" download>
                  <Download className="size-4" /> Download backup (.zip)
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Restore */}
      <section className="rounded-xl border border-border p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
            <RotateCcw className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-medium">Restore from a backup</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Import an Tavoro backup archive. It always restores into a <strong>new</strong>{" "}
              workspace (your current one is never overwritten), and you&rsquo;ll be switched into the
              restored copy. Members are matched by email; restored accounts start without a password
              until an admin sets one.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input
                ref={inputRef}
                type="file"
                accept=".zip"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
                <Upload className="size-4" /> {file ? "Choose a different file" : "Choose backup file"}
              </Button>
              {file && <span className="truncate text-sm text-muted-foreground">{file.name}</span>}
            </div>
            {file && (
              <div className="mt-3">
                <Button onClick={restore} disabled={busy}>
                  {busy ? "Restoring…" : "Restore into a new workspace"}
                </Button>
              </div>
            )}
            {status && (
              <p
                className={
                  "mt-3 text-sm " +
                  (status.tone === "error"
                    ? "text-destructive-ink"
                    : status.tone === "ok"
                      ? "text-success-ink"
                      : "text-muted-foreground")
                }
              >
                {status.text}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Card-key backfill */}
      <section className="rounded-xl border border-border p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
            <Tag className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-medium">Backfill card keys</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Assigns an auto-derived, unique prefix (e.g. &ldquo;Course Production Pipeline&rdquo; →
              &ldquo;CPP&rdquo;) to every board in this workspace that doesn&rsquo;t have one yet, and
              numbers all of its existing cards and subtasks. Safe to re-run — boards and cards that
              already have a key are left untouched.
            </p>
            <div className="mt-4">
              <Button onClick={runBackfill} disabled={backfillPending} variant="outline">
                {backfillPending ? "Backfilling…" : "Backfill card keys"}
              </Button>
            </div>
            {backfillResult && (
              <div className="mt-3 text-sm">
                {typeof backfillResult === "string" ? (
                  <p className="text-destructive-ink">{backfillResult}</p>
                ) : backfillResult.length === 0 ? (
                  <p className="text-muted-foreground">Every board already has a card-key prefix.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-muted-foreground">
                    {backfillResult.map((r) => (
                      <li key={r.boardName}>
                        <strong className="text-foreground">{r.prefix}</strong> — {r.boardName} ({r.count}{" "}
                        card{r.count === 1 ? "" : "s"} labeled)
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
