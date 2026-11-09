"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, KeyRound, Unplug } from "lucide-react";

import { connectApp, disconnectApp, rotateAppKey } from "@/app/actions/connected-apps";
import { ConfirmDelete } from "@/components/shared/confirm-delete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Settings → Connected apps (docs/SUITE.md): CourseForge signs people in with Tavoro.

type AppRow = { id: string; name: string; url: string; secretHint: string; createdAt: string; lastUsedAt: string | null; lastSyncAt: string | null };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");

export function ConnectedApps({ apps, workspaceName }: { apps: AppRow[]; workspaceName: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await connectApp(url);
    setBusy(false);
    if ("error" in res) return setError(res.error ?? "Couldn’t connect.");
    setKey(res.key);
    setUrl("");
    router.refresh();
  }

  async function copy() {
    if (!key) return;
    await navigator.clipboard.writeText(key).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Connected apps</h2>
        <p className="text-sm text-muted-foreground">
          Let people sign in to CourseForge with their Tavoro account. Members of {workspaceName} can sign in there, and anyone you
          suspend or remove here is signed out there within a few minutes. If this workspace requires single sign-on, so does the
          connected app.
        </p>
      </section>

      {key && (
        <section role="status" className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm">
          <p className="font-medium">Copy this key into CourseForge</p>
          <p className="text-muted-foreground">
            In CourseForge, open <span className="font-medium text-foreground">Admin → Settings → Sign in with Tavoro</span> and paste it.
            It’s shown only once.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={key} aria-label="Connection key" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" variant="outline" onClick={copy}>
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setKey(null)}>
            Done
          </Button>
        </section>
      )}

      {apps.length > 0 && (
        <section aria-label="Apps" className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {apps.map((a) => (
            <div key={a.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{a.name}</p>
                <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-accent hover:underline">
                  {a.url}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
                <p className="mt-1 text-xs text-muted-foreground" suppressHydrationWarning>
                  Key ending …{a.secretHint} · last sign-in {when(a.lastUsedAt)} · last member sync {when(a.lastSyncAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
              <ConfirmDelete
                title={`Give ${a.name} a new key?`}
                description={`The current key stops working at once: paste the new key into ${a.name} (Admin → Settings → Sign in with Tavoro) straight away. Cards stay linked to their courses.`}
                confirmLabel="New key"
                onConfirm={async () => {
                  const r = await rotateAppKey(a.id);
                  if ("key" in r && r.key) setKey(r.key);
                  router.refresh();
                  return r;
                }}
                trigger={
                  <Button type="button" variant="outline" size="sm">
                    <KeyRound className="size-4" aria-hidden />
                    New key
                  </Button>
                }
              />
              <ConfirmDelete
                title={`Disconnect ${a.name}?`}
                description={`People can no longer sign in to ${a.name} with Tavoro, its key stops working, and cards lose their links to its courses. Their ${a.name} accounts and courses stay.`}
                confirmLabel="Disconnect"
                onConfirm={async () => {
                  const r = await disconnectApp(a.id);
                  router.refresh();
                  return r;
                }}
                trigger={
                  <Button type="button" variant="outline" size="sm">
                    <Unplug className="size-4" aria-hidden />
                    Disconnect
                  </Button>
                }
              />
              </div>
            </div>
          ))}
        </section>
      )}

      <form onSubmit={connect} className="flex flex-col gap-2">
        <Label htmlFor="app-url">{apps.length ? "Connect another CourseForge" : "Connect CourseForge"}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="app-url"
            type="url"
            required
            placeholder="https://courseforge.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="min-w-0 flex-1 basis-64"
            aria-describedby={error ? "app-url-error" : undefined}
          />
          <Button type="submit" disabled={busy}>
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </div>
        {error && (
          <p id="app-url-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
