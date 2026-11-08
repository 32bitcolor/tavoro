"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { submitIntakeRequest } from "@/app/actions/intake";
import type { IntakeField } from "@/lib/intake-fields";

/** One of the workspace's own questions. Inputs are named q_<id>. */
function ExtraField({ f }: { f: IntakeField }) {
  const id = `q_${f.id}`;
  const label = (
    <Label htmlFor={id}>
      {f.label}
      {!f.required && <span className="font-normal text-muted-foreground"> (optional)</span>}
    </Label>
  );
  const help = f.help ? (
    <p id={`${id}-help`} className="text-xs text-muted-foreground">
      {f.help}
    </p>
  ) : null;
  const described = f.help ? `${id}-help` : undefined;
  if (f.type === "yes_no") {
    return (
      <fieldset className="flex flex-col gap-1.5" aria-describedby={described}>
        <legend className="mb-1.5 text-sm font-medium">
          {f.label}
          {!f.required && <span className="font-normal text-muted-foreground"> (optional)</span>}
        </legend>
        <div className="flex gap-4 text-sm">
          {(["yes", "no"] as const).map((v) => (
            <label key={v} className="inline-flex items-center gap-1.5">
              <input type="radio" name={id} value={v} required={f.required} className="accent-[var(--accent)]" />
              {v === "yes" ? "Yes" : "No"}
            </label>
          ))}
        </div>
        {help}
      </fieldset>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {f.type === "long_text" ? (
        <Textarea id={id} name={id} required={f.required} maxLength={4000} rows={3} aria-describedby={described} />
      ) : f.type === "choice" ? (
        <Select id={id} name={id} required={f.required} defaultValue="" aria-describedby={described}>
          <option value="" disabled={f.required}>
            {f.required ? "Choose…" : "No answer"}
          </option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ) : f.type === "date" ? (
        <Input id={id} name={id} type="date" required={f.required} aria-describedby={described} />
      ) : (
        <Input id={id} name={id} required={f.required} maxLength={280} aria-describedby={described} />
      )}
      {help}
    </div>
  );
}

export function IntakeForm({ workspaceId, workspaceName, fields = [] }: { workspaceId: string; workspaceName: string; fields?: IntakeField[] }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [statusPath, setStatusPath] = useState<string | null>(null);

  // onSubmit, not a form action: an action resets the form, which would wipe what the
  // requester wrote whenever the server turns a submission away.
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const result = await submitIntakeRequest(workspaceId, formData);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setTicket(result.ticket || "received");
    setStatusPath(result.statusPath ?? null);
  }

  if (ticket) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircle2 className="size-9 text-success-ink" />
        <h2 className="font-medium">Thanks — your request is in</h2>
        <p className="text-sm text-muted-foreground">
          {ticket !== "received" && (
            <>
              Reference: <span className="font-mono">{ticket}</span>. {" "}
            </>
          )}
          The {workspaceName} team will be in touch.
        </p>
        {statusPath && (
          <>
            <Button asChild className="mt-2">
              <a href={statusPath}>Track your request</a>
            </Button>
            <p className="text-xs text-muted-foreground">
              We&rsquo;ve also emailed you this link. On that page you can follow your request and reply to the team.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Submit a request for training or content, and the {workspaceName} team will review it.
      </p>

      {/* Honeypot — invisible to real users, a magnet for naive bots. */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" name="name" required maxLength={140} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Your email</Label>
          <Input id="email" name="email" type="email" required maxLength={200} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">What do you need?</Label>
        <Input id="title" name="title" required maxLength={140} placeholder="e.g. New hire safety training" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Tell us more</Label>
        <Textarea id="description" name="description" required maxLength={4000} rows={5} />
      </div>

      {fields.map((f) => (
        <ExtraField key={f.id} f={f} />
      ))}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="targetAudience">Audience (optional)</Label>
          <Input id="targetAudience" name="targetAudience" maxLength={280} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="targetDate">Needed by (optional)</Label>
          <Input id="targetDate" name="targetDate" type="date" />
        </div>
      </div>

      {error && <p className="text-sm text-destructive-ink">{error}</p>}

      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? "Submitting…" : "Submit request"}
      </Button>
    </form>
  );
}
