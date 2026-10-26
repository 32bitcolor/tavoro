"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Send } from "lucide-react";
import { postIntakeMessage } from "@/app/actions/intake";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeader } from "@/components/shared/page";
import { cn } from "@/lib/utils";
import { LocalTime } from "@/components/shared/local-time";
import { LinkifiedText } from "@/components/shared/linkified-text";

export type IntakeMessageDTO = {
  id: string;
  kind: "reply" | "note";
  fromRequester: boolean;
  author: string;
  body: string;
  at: string;
};

/** The request's conversation: replies (shared with the requester on their status page
 *  and by email) and internal notes (team only). */
export function IntakeConversation({
  requestId,
  requesterName,
  messages,
  canPost,
  canAsk,
}: {
  requestId: string;
  requesterName: string;
  messages: IntakeMessageDTO[];
  /** Admins, managers and the assigned member. */
  canPost: boolean;
  /** Asking marks the request Needs info, so only while it's undecided. */
  canAsk: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [ask, setAsk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function post(kind: "reply" | "note") {
    setError(null);
    startTransition(async () => {
      const res = await postIntakeMessage(requestId, { body, kind, needsInfo: kind === "reply" && ask && canAsk });
      if (res?.error) {
        setError(res.error);
        return;
      }
      setBody("");
      setAsk(false);
      router.refresh();
    });
  }

  return (
    <Card className="gap-4 p-6">
      <SectionHeader>Conversation</SectionHeader>
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing yet. Replies go to {requesterName} by email and appear on their status page; internal notes stay with
          the team.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                "rounded-lg border p-3 text-sm",
                m.kind === "note"
                  ? "border-dashed border-border-strong bg-muted/50"
                  : m.fromRequester
                    ? "border-accent/30 bg-accent/7"
                    : "border-border",
              )}
            >
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{m.author}</span>
                {m.fromRequester && <span>requester</span>}
                {m.kind === "note" && (
                  <span className="inline-flex items-center gap-1">
                    <Lock className="size-3" aria-hidden="true" /> Internal note
                  </span>
                )}
                {m.kind === "reply" && !m.fromRequester && <span>to the requester</span>}
                <span>· <LocalTime iso={m.at} format="dateTime" /></span>
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words"><LinkifiedText text={m.body} /></p>
            </li>
          ))}
        </ul>
      )}

      {canPost && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            post("reply");
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="intake-message" className="sr-only">Message</label>
          <Textarea
            id="intake-message"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            rows={3}
            placeholder={`Reply to ${requesterName}, or add an internal note…`}
          />
          {canAsk && (
            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={ask} onChange={(e) => setAsk(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-accent" />
              <span>
                It&rsquo;s a question: mark the request <span className="font-medium text-foreground">Needs info</span> until they reply
              </span>
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending || !body.trim()}>
              <Send className="size-4" /> {ask && canAsk ? "Ask the requester" : "Send to requester"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending || !body.trim() || ask} onClick={() => post("note")}>
              <Lock className="size-4" /> Add internal note
            </Button>
            {error && <span role="alert" className="text-sm text-destructive-ink">{error}</span>}
          </div>
        </form>
      )}
    </Card>
  );
}
