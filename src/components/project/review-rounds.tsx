"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, FileText, Film, Image as ImageIcon, ListChecks, MessageSquare, Plus, ShieldCheck, Upload, UserRound, X } from "lucide-react";
import { discardReviewFile, startReviewRound, type RoundTarget } from "@/app/actions/reviews";
import { REVIEW_STATUS_LABEL, isApproval, type ReviewStatus } from "@/lib/methodology";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";

type Member = { id: string; name: string | null; email: string };
export type RoundSummary = {
  id: string;
  number: number;
  outcome: string | null;
  overridden: boolean;
  dueDate: string | null;
  openComments: number;
  hasSnapshot: boolean;
  file: ReviewFileInfo | null;
  reviewers: { id: string; name: string; status: string; guest: Guest | null }[];
};
type Guest = { name: string; email: string };
export type ReviewFileInfo = { id: string; fileName: string; mimeType: string };

export function FileGlyph({ mimeType, className }: { mimeType: string; className?: string }) {
  const Icon = mimeType === "application/pdf" ? FileText : mimeType.startsWith("video/") ? Film : ImageIcon;
  return <Icon className={cn("size-3.5 shrink-0", className)} aria-hidden="true" />;
}

export function roundTone(outcome: string | null): StatusTone {
  if (outcome === "passed") return "success";
  if (outcome === "changes_requested") return "warning";
  return "info";
}

export function roundLabel(outcome: string | null, overridden: boolean): string {
  if (outcome === "passed") return overridden ? "Passed by override" : "Passed";
  if (outcome === "changes_requested") return "Changes requested";
  return "In review";
}

export const DECISION_DOT: Record<string, string> = {
  requested: "bg-muted-foreground/50",
  in_review: "bg-info",
  changes_requested: "bg-warning",
  approved_with_changes: "bg-success/60",
  approved: "bg-success",
};

/** A deliverable's review rounds, newest first, and the form to start the next one. */
export function ReviewRounds({
  deliverableId,
  members,
  rounds,
  storyboard,
}: {
  deliverableId: string;
  members: Member[];
  rounds: RoundSummary[];
  storyboard: { id: string; title: string } | null;
}) {
  const [starting, setStarting] = useState(false);
  const latest = rounds[0];

  return (
    <div className="mt-3 flex flex-col gap-2">
      {rounds.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {rounds.map((r) => {
            const approved = r.reviewers.filter((x) => isApproval(x.status)).length;
            return (
              <li key={r.id}>
                <Link
                  href={`/reviews/${r.id}`}
                  className={cn(
                    "group flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-hover",
                    // Older rounds recede by background, not by fading their text.
                    r !== latest && "bg-surface-muted",
                  )}
                >
                  <span className="font-semibold">Round {r.number}</span>
                  {r.file && (
                    <span className="inline-flex max-w-48 items-center gap-1 truncate text-xs text-muted-foreground">
                      <FileGlyph mimeType={r.file.mimeType} />
                      <span className="truncate">{r.file.fileName}</span>
                    </span>
                  )}
                  <StatusBadge tone={roundTone(r.outcome)}>
                    {r.overridden && <ShieldCheck className="size-3" aria-hidden="true" />}
                    {roundLabel(r.outcome, r.overridden)}
                  </StatusBadge>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {r.reviewers.map((x) => (
                      <span key={x.id} className="inline-flex items-center gap-1" title={REVIEW_STATUS_LABEL[x.status as ReviewStatus] ?? x.status}>
                        <span className={cn("size-1.5 rounded-full", DECISION_DOT[x.status] ?? "bg-muted-foreground/50")} aria-hidden="true" />
                        {x.name}
                        {x.guest && <span className="text-muted-foreground">(guest)</span>}
                        <span className="sr-only">: {REVIEW_STATUS_LABEL[x.status as ReviewStatus] ?? x.status}</span>
                      </span>
                    ))}
                    {r.reviewers.length > 1 && <span>· {approved}/{r.reviewers.length} approved</span>}
                  </span>
                  <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                    {r.openComments > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="size-3.5" aria-hidden="true" />
                        {r.openComments} open
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 font-medium text-foreground group-hover:underline">
                      Open review <ArrowRight className="size-3.5" aria-hidden="true" />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {starting ? (
        <StartRoundForm
          deliverableId={deliverableId}
          members={members}
          nextNumber={(latest?.number ?? 0) + 1}
          previousReviewers={latest?.reviewers.filter((r) => !r.guest).map((r) => r.id) ?? []}
          previousGuests={latest?.reviewers.flatMap((r) => (r.guest ? [r.guest] : [])) ?? []}
          storyboard={storyboard}
          previousFile={latest?.file ?? null}
          onDone={() => setStarting(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setStarting(true)}
            className="flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <Plus className="size-4" aria-hidden="true" />
            {rounds.length ? `Start round ${(latest?.number ?? 0) + 1}` : "Request a review"}
          </button>
          {rounds.length > 0 && (
            <Link
              href={`/reviews/feedback/${deliverableId}`}
              className="flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-hover hover:text-foreground"
            >
              <ListChecks className="size-4" aria-hidden="true" />
              All feedback
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function StartRoundForm({
  deliverableId,
  members,
  nextNumber,
  previousReviewers,
  previousGuests,
  storyboard,
  previousFile,
  onDone,
}: {
  deliverableId: string;
  members: Member[];
  nextNumber: number;
  previousReviewers: string[];
  previousGuests: Guest[];
  storyboard: { id: string; title: string } | null;
  previousFile: ReviewFileInfo | null;
  onDone: () => void;
}) {
  const router = useRouter();
  // A follow-up round usually goes back to the same people, guests included.
  const [picked, setPicked] = useState<Set<string>>(new Set(previousReviewers));
  const [guests, setGuests] = useState<Guest[]>(previousGuests);
  const [due, setDue] = useState("");
  // What's under review: the storyboard by default; a file when there's no storyboard,
  // or when the last round reviewed one.
  const [kind, setKind] = useState<"storyboard" | "file" | "none">(storyboard && !previousFile ? "storyboard" : "file");
  const [file, setFile] = useState<ReviewFileInfo | null>(previousFile);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function cancel() {
    if (file && file.id !== previousFile?.id) void discardReviewFile(file.id);
    onDone();
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    let target: RoundTarget | undefined;
    if (kind === "file") {
      if (!file) return setError("Upload the file to review, or choose another option.");
      target = { kind: "file", fileId: file.id };
    } else if (kind === "storyboard") target = { kind: "storyboard" };
    startTransition(async () => {
      const res = await startReviewRound(
        deliverableId,
        { memberIds: [...picked], guests },
        due ? new Date(due).toISOString() : null,
        target,
      );
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      onDone();
      if (res && "roundId" in res) router.push(`/reviews/${res.roundId}`);
    });
  }

  const count = picked.size + guests.length;

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-semibold">Start round {nextNumber}</legend>
      <div role="radiogroup" aria-label="What's being reviewed" className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">What&apos;s being reviewed</span>
        <div className="flex flex-wrap gap-1.5">
          {storyboard && (
            <TargetChoice on={kind === "storyboard"} onClick={() => setKind("storyboard")}>
              Storyboard: {storyboard.title}
            </TargetChoice>
          )}
          <TargetChoice on={kind === "file"} onClick={() => setKind("file")}>A PDF, image or video</TargetChoice>
          <TargetChoice on={kind === "none"} onClick={() => setKind("none")}>Nothing to pin to — general feedback</TargetChoice>
        </div>
        {kind === "storyboard" && (
          <p className="text-xs text-muted-foreground">A copy is frozen when the round starts, so you can keep editing.</p>
        )}
        {kind === "file" && (
          <FilePicker
            deliverableId={deliverableId}
            file={file}
            previousFile={previousFile}
            onChange={(f) => {
              if (file && file.id !== previousFile?.id && file.id !== f?.id) void discardReviewFile(file.id);
              setFile(f);
            }}
          />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Reviewers — the round passes when all of them approve
        </span>
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => {
            const on = picked.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(m.id)}
                className={cn(
                  "h-7 rounded-full border px-2.5 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  on ? "border-accent/40 bg-accent/10 text-foreground" : "border-dashed border-border-strong text-muted-foreground hover:bg-hover",
                )}
              >
                {m.name ?? m.email}
              </button>
            );
          })}
        </div>
      </div>
      <GuestList guests={guests} onChange={setGuests} />
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Due</span>
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 w-auto" />
      </label>
      {error && <p role="alert" className="text-sm text-destructive-ink">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={pending || count === 0}>
          {pending ? "Starting…" : `Start round ${nextNumber}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
      </div>
    </fieldset>
  );
}

/** Outside reviewers (SMEs without an account): name + email. Each gets a personal
 *  review link by email when the round starts. */
export function GuestList({ guests, onChange }: { guests: Guest[]; onChange: (g: Guest[]) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    const n = name.trim();
    const e = email.trim().toLowerCase();
    if (!n || !e) return setError("Enter a name and an email.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setError("That email doesn't look right.");
    if (guests.some((g) => g.email === e)) return setError("They're already on the list.");
    onChange([...guests, { name: n, email: e }]);
    setName("");
    setEmail("");
    setError(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Guests — outside reviewers, no account needed</span>
      {guests.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {guests.map((g) => (
            <li
              key={g.email}
              className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 pr-1 pl-2.5 text-xs font-medium"
            >
              <UserRound className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{g.name}</span>
              <span className="truncate font-normal text-muted-foreground">{g.email}</span>
              <button
                type="button"
                onClick={() => onChange(guests.filter((x) => x.email !== g.email))}
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground"
                aria-label={`Remove ${g.name}`}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div
        className="flex flex-wrap gap-1.5"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Guest name" className="h-8 w-40 grow sm:grow-0" />
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          aria-label="Guest email"
          className="h-8 w-56 grow sm:grow-0"
        />
        <Button size="sm" variant="outline" type="button" onClick={add}>
          <Plus className="size-3.5" aria-hidden="true" /> Add guest
        </Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive-ink">{error}</p>}
    </div>
  );
}

function TargetChoice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "h-7 max-w-full truncate rounded-full border px-2.5 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        on ? "border-accent/40 bg-accent/10 text-foreground" : "border-dashed border-border-strong text-muted-foreground hover:bg-hover",
      )}
    >
      {children}
    </button>
  );
}

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm";
const MAX_BYTES = 95 * 1024 * 1024; // one request; larger files go up in parts
const MAX_MULTIPART_BYTES = 500 * 1024 * 1024;

/** PUT one part with progress; resolves true when the server took it. */
function sendPart(url: string, blob: Blob, onProgress: (fraction: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => resolve(xhr.status === 200);
    xhr.onerror = () => resolve(false);
    xhr.send(blob);
  });
}

function fmtSize(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Upload the file a round will review. Streams the raw bytes to the server (no
 *  multipart), with progress. Offers last round's file again for a re-review. */
function FilePicker({
  deliverableId,
  file,
  previousFile,
  onChange,
}: {
  deliverableId: string;
  file: ReviewFileInfo | null;
  previousFile: ReviewFileInfo | null;
  onChange: (f: ReviewFileInfo | null) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function upload(f: File) {
    setError(null);
    if (f.size > MAX_MULTIPART_BYTES) return setError("Files can be up to 500 MB.");
    if (f.size > MAX_BYTES) return void uploadInParts(f);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/review-files?deliverableId=${encodeURIComponent(deliverableId)}&name=${encodeURIComponent(f.name)}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total);
    xhr.onload = () => {
      setProgress(null);
      let body: { file?: ReviewFileInfo; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 200 && body.file) onChange(body.file);
      else setError(body.error ?? (xhr.status === 413 ? "Files can be up to 95 MB." : "Upload failed — please try again."));
    };
    xhr.onerror = () => {
      setProgress(null);
      setError("Upload failed — check your connection and try again.");
    };
    setProgress(0);
    xhr.send(f);
  }

  /** Over 95 MB (a long video): in 50 MB parts, each its own request, so none hits
   *  Cloudflare's 100 MB cap. A failed part is retried twice before giving up. */
  async function uploadInParts(f: File) {
    const base = "/api/review-files/multipart";
    const fail = (msg: string) => {
      setProgress(null);
      setError(msg);
    };
    setProgress(0);
    let uploadId: string | null = null;
    try {
      const start = await fetch(`${base}?action=start&deliverableId=${encodeURIComponent(deliverableId)}&name=${encodeURIComponent(f.name)}&size=${f.size}`, { method: "POST" });
      const s = (await start.json()) as { uploadId?: string; partSize?: number; parts?: number; error?: string };
      if (!start.ok || !s.uploadId || !s.partSize || !s.parts) return fail(s.error ?? "Upload failed — please try again.");
      uploadId = s.uploadId;
      for (let i = 0; i < s.parts; i++) {
        const blob = f.slice(i * s.partSize, Math.min(f.size, (i + 1) * s.partSize));
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          ok = await sendPart(`${base}?uploadId=${encodeURIComponent(uploadId)}&part=${i + 1}`, blob, (p) => setProgress((i * s.partSize! + p * blob.size) / f.size));
        }
        if (!ok) {
          await fetch(`${base}?uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE" });
          return fail("Upload failed — check your connection and try again.");
        }
      }
      const done = await fetch(`${base}?action=complete&uploadId=${encodeURIComponent(uploadId)}`, { method: "POST" });
      const body = (await done.json()) as { file?: ReviewFileInfo; error?: string };
      setProgress(null);
      if (done.ok && body.file) onChange(body.file);
      else setError(body.error ?? "Upload failed — please try again.");
    } catch {
      if (uploadId) await fetch(`${base}?uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE" }).catch(() => {});
      fail("Upload failed — check your connection and try again.");
    }
  }

  if (file) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5">
          <FileGlyph mimeType={file.mimeType} className="text-muted-foreground" />
          <span className="truncate font-medium">{file.fileName}</span>
          {file.id === previousFile?.id && <span className="text-xs text-muted-foreground">(same as last round)</span>}
        </span>
        <Button size="xs" variant="ghost" type="button" onClick={() => onChange(null)}>
          Choose a different file
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) upload(f);
        }}
        className={cn(
          "relative flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed px-4 py-5 text-center text-sm focus-within:ring-[3px] focus-within:ring-ring/50",
          dragging ? "border-accent bg-accent/5" : "border-border-strong hover:bg-hover",
        )}
      >
        <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
        {progress != null ? (
          <span className="w-full max-w-60">
            <span className="mb-1 block text-xs text-muted-foreground">Uploading… {Math.round(progress * 100)}%</span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <span className="block h-full bg-accent transition-[width]" style={{ width: `${progress * 100}%` }} />
            </span>
          </span>
        ) : (
          <>
            <span>
              <span className="font-medium text-foreground">Choose a file</span> or drop it here
            </span>
            <span className="text-xs text-muted-foreground">PDF, PNG, JPEG, WebP or GIF up to {fmtSize(MAX_BYTES)} · MP4 or WebM video up to {fmtSize(MAX_MULTIPART_BYTES)}</span>
          </>
        )}
        <input
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={progress != null}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </label>
      {previousFile && (
        <button
          type="button"
          onClick={() => onChange(previousFile)}
          className="w-fit text-xs font-medium text-accent hover:underline"
        >
          Use the same file as last round ({previousFile.fileName})
        </button>
      )}
      {error && <p role="alert" className="text-xs text-destructive-ink">{error}</p>}
    </div>
  );
}
