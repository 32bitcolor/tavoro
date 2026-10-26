"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleHelp, Send } from "lucide-react";
import { replyAsRequester } from "@/app/actions/intake-status";
import type { StatusPage } from "@/lib/intake-status";
import { ticketLabel } from "@/lib/intake";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LocalTime } from "@/components/shared/local-time";
import { LinkifiedText } from "@/components/shared/linkified-text";

// What the requester sees (lib/intake-status.ts decides what's in `page`).

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Three plain-language steps; the request's status says how far along it is. */
function steps(status: string) {
  const decided = status === "converted" || status === "rejected";
  const reviewing = status !== "submitted";
  return [
    { label: "Submitted", done: true, current: status === "submitted" },
    { label: status === "needs_info" ? "Waiting on you" : "Under review", done: decided, current: reviewing && !decided },
    { label: status === "converted" ? "Approved" : status === "rejected" ? "Not going ahead" : "Decision", done: decided, current: decided },
  ];
}

export function StatusView({ page, token }: { page: StatusPage; token: string }) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await replyAsRequester(token, reply);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setReply("");
      setSent(true);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div>
        <p className="font-mono text-xs text-muted-foreground">{ticketLabel(page.number)}</p>
        <h1 className="mt-1 text-2xl font-semibold break-words">{page.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sent to {page.workspaceName} on <LocalTime iso={page.submittedAt} format="longDate" />
        </p>
      </div>

      <ol className="grid grid-cols-3 gap-2" aria-label="Progress">
        {steps(page.status).map((s, i) => (
          <li key={i} className="flex flex-col gap-2" aria-current={s.current ? "step" : undefined}>
            <span
              className={cn(
                "h-1.5 rounded-full",
                s.done || s.current ? (page.status === "rejected" && i === 2 ? "bg-muted-foreground" : "bg-accent") : "bg-border",
              )}
            />
            <span className={cn("text-sm", s.current ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {s.done && !s.current && <Check className="mr-1 inline size-3.5" aria-hidden="true" />}
              {s.label}
            </span>
          </li>
        ))}
      </ol>

      {page.status === "needs_info" && (
        <div className="flex gap-3 rounded-xl border border-warning/35 bg-warning/7 p-4 text-sm">
          <CircleHelp className="mt-0.5 size-4 shrink-0 text-warning-ink" aria-hidden="true" />
          <p>The team has a question for you. It&rsquo;s in the conversation below; your reply goes straight to them.</p>
        </div>
      )}
      {page.status === "converted" && (
        <div className="rounded-xl border border-success/35 bg-success/7 p-4 text-sm">
          <p className="font-medium text-success-ink">Approved{page.decidedAt && <> on <LocalTime iso={page.decidedAt} format="longDate" /></>}</p>
          <p className="mt-1 text-muted-foreground">The {page.workspaceName} team is now working on it.</p>
        </div>
      )}
      {page.status === "rejected" && (
        <div className="rounded-xl border border-border bg-muted/60 p-4 text-sm">
          <p className="font-medium">Not going ahead{page.decidedAt && <> (decided <LocalTime iso={page.decidedAt} format="longDate" />)</>}</p>
          {page.rejectionReason && <p className="mt-1 whitespace-pre-wrap text-muted-foreground"><LinkifiedText text={page.rejectionReason} /></p>}
        </div>
      )}

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">What you asked for</h2>
        <p className="mt-2 text-sm whitespace-pre-wrap break-words"><LinkifiedText text={page.description} /></p>
        {(page.targetAudience || page.targetDate) && (
          <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            {page.targetAudience && (
              <div>
                <dt className="inline text-muted-foreground">Audience: </dt>
                <dd className="inline">{page.targetAudience}</dd>
              </div>
            )}
            {page.targetDate && (
              <div>
                <dt className="inline text-muted-foreground">Needed by: </dt>
                <dd className="inline">{fmtDay(page.targetDate)}</dd>
              </div>
            )}
          </dl>
        )}
      </section>

      <section aria-labelledby="conversation" className="flex flex-col gap-3">
        <h2 id="conversation" className="text-sm font-semibold">Conversation</h2>
        {page.messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No messages yet. If you think of anything to add, write it below and the team will see it.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {page.messages.map((m) => (
              <li
                key={m.id}
                className={cn(
                  "max-w-[85%] rounded-xl border p-3 text-sm",
                  m.fromRequester ? "self-end border-accent/30 bg-accent/7" : "self-start border-border bg-surface",
                )}
              >
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{m.fromRequester ? "You" : m.author}</span> · <LocalTime iso={m.at} format="dateTime" />
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words"><LinkifiedText text={m.body} /></p>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="reply" className="sr-only">Your reply</label>
          <Textarea
            id="reply"
            value={reply}
            onChange={(e) => {
              setReply(e.target.value);
              setSent(false);
            }}
            maxLength={5000}
            rows={4}
            placeholder={page.status === "needs_info" ? "Answer the team's question…" : "Add something, or ask the team a question…"}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || !reply.trim()}>
              <Send className="size-4" />
              {pending ? "Sending…" : "Send"}
            </Button>
            {sent && <span role="status" className="text-sm text-success-ink">Sent. The team has been told.</span>}
            {error && <span role="alert" className="text-sm text-destructive-ink">{error}</span>}
          </div>
        </form>
      </section>

      <p className="text-xs text-muted-foreground">
        Keep this link to yourself: anyone who has it can see this page and reply as you.
      </p>
    </div>
  );
}
