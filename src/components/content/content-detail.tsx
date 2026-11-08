"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, CheckCircle2, ExternalLink, Trash2 } from "lucide-react";

import { deleteContentItem, markContentReviewed, setContentLabels, updateContentItem, type ContentFields } from "@/app/actions/content";
import {
  CONTENT_STATUSES,
  CONTENT_STATUS_LABEL,
  CONTENT_TYPES,
  CONTENT_TYPE_LABEL,
  dayValue,
  formatDay,
  LIFECYCLE_LABEL,
  LIFECYCLE_TONE,
  REVIEW_INTERVALS,
  type ContentStatus,
  type ContentType,
  type Lifecycle,
} from "@/lib/content";
import { useSetPageTitle } from "@/components/app-shell/breadcrumbs";
import { InlineTitle } from "@/components/shared/inline-title";
import { ConfirmDelete } from "@/components/shared/confirm-delete";
import { StatusBadge } from "@/components/shared/status-badge";
import { SectionHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  title: string;
  description: string | null;
  contentType: string;
  status: string;
  externalUrl: string | null;
  ownerId: string | null;
  publishedAt: string | null;
  reviewDate: string | null;
  reviewIntervalMonths: number | null;
  lastReviewedAt: string | null;
  expiryDate: string | null;
  project: { id: string; name: string } | null;
  deliverable: { id: string; name: string } | null;
  labelIds: string[];
  lifecycle: Lifecycle;
  reason: string | null;
  updatedAt: string;
};

type Form = {
  contentType: string;
  status: string;
  ownerId: string;
  externalUrl: string;
  description: string;
  publishedAt: string;
  reviewDate: string;
  reviewIntervalMonths: string;
  expiryDate: string;
};

const formOf = (it: Item): Form => ({
  contentType: it.contentType,
  status: it.status,
  ownerId: it.ownerId ?? "",
  externalUrl: it.externalUrl ?? "",
  description: it.description ?? "",
  publishedAt: dayValue(it.publishedAt),
  reviewDate: dayValue(it.reviewDate),
  reviewIntervalMonths: it.reviewIntervalMonths ? String(it.reviewIntervalMonths) : "",
  expiryDate: dayValue(it.expiryDate),
});

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ContentDetail({
  item,
  members,
  labels,
  canDelete,
  children,
}: {
  item: Item;
  members: { id: string; label: string }[];
  labels: { id: string; name: string; color: string }[];
  canDelete: boolean;
  /** Extra sections (the asset list), shown after labels. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(item.title);
  const [form, setForm] = useState<Form>(() => formOf(item));
  const [labelIds, setLabelIds] = useState(() => new Set(item.labelIds));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  // When the server copy changes (a save, "Mark reviewed"), start the form from it.
  const [seen, setSeen] = useState(item.updatedAt);
  if (seen !== item.updatedAt) {
    setSeen(item.updatedAt);
    setForm(formOf(item));
  }
  useSetPageTitle(title, [{ label: "Content", href: "/content" }]);

  const saved = formOf(item);
  const dirty = (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== saved[k]);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function run(fn: () => Promise<unknown>, ok?: string) {
    setMessage(null);
    start(async () => {
      const res = (await fn()) as { error?: string } | undefined;
      if (res && "error" in res && res.error) setMessage({ tone: "error", text: res.error });
      else {
        if (ok) setMessage({ tone: "ok", text: ok });
        router.refresh();
      }
    });
  }

  function save() {
    const patch: Partial<ContentFields> = {
      contentType: form.contentType as ContentType,
      status: form.status as ContentStatus,
      ownerId: form.ownerId || null,
      externalUrl: form.externalUrl.trim() || null,
      description: form.description.trim() || null,
      publishedAt: form.publishedAt || null,
      reviewDate: form.reviewDate || null,
      reviewIntervalMonths: form.reviewIntervalMonths ? Number(form.reviewIntervalMonths) : null,
      expiryDate: form.expiryDate || null,
    };
    run(() => updateContentItem(item.id, patch), "Saved.");
  }

  function toggleLabel(id: string) {
    const next = new Set(labelIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setLabelIds(next);
    run(() => setContentLabels(item.id, [...next]));
  }

  const retired = item.status === "retired";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <InlineTitle
          value={title}
          onChange={setTitle}
          onCommit={() => title.trim() && title !== item.title && run(() => updateContentItem(item.id, { title }))}
          ariaLabel="Content title"
          className="text-2xl font-semibold tracking-tight"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <StatusBadge tone={LIFECYCLE_TONE[item.lifecycle]}>{LIFECYCLE_LABEL[item.lifecycle]}</StatusBadge>
          {item.reason && <span className="text-muted-foreground">{item.reason}</span>}
          {item.externalUrl && (
            <a href={item.externalUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-link inline-flex items-center gap-1">
              Open where it lives <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>

      {!retired && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-sm">
            {item.lastReviewedAt ? <>Last reviewed {formatDay(item.lastReviewedAt)}. </> : <>Not reviewed in Tavoro yet. </>}
            <span className="text-muted-foreground">
              Marking it reviewed sets the next review {item.reviewIntervalMonths ?? 12} months from today.
            </span>
          </p>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markContentReviewed(item.id), "Marked as reviewed.")}>
            <CheckCircle2 className="size-4" aria-hidden="true" /> Mark reviewed
          </Button>
        </div>
      )}

      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <section>
          <SectionHeader>Details</SectionHeader>
          <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label="Type" htmlFor="c-type">
              <Select id="c-type" value={form.contentType} onChange={set("contentType")}>
                {CONTENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CONTENT_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="c-status">
              <Select id="c-status" value={form.status} onChange={set("status")}>
                {CONTENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CONTENT_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Owner" htmlFor="c-owner" hint="Who answers for it now that it's live. Reminders go to them.">
              <Select id="c-owner" value={form.ownerId} onChange={set("ownerId")}>
                <option value="">No owner (admins and managers are reminded)</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Where it lives" htmlFor="c-url" hint="The LMS course, share link or file.">
              <Input id="c-url" type="url" value={form.externalUrl} onChange={set("externalUrl")} placeholder="https://" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes" htmlFor="c-desc">
                <Textarea id="c-desc" rows={3} value={form.description} onChange={set("description")} maxLength={5000} />
              </Field>
            </div>
          </div>
        </section>

        <section>
          <SectionHeader>Dates</SectionHeader>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
            <Field label="Published" htmlFor="c-pub">
              <Input id="c-pub" type="date" value={form.publishedAt} onChange={set("publishedAt")} />
            </Field>
            <Field label="Next review" htmlFor="c-review" hint="Reminders 30 and 7 days before.">
              <Input id="c-review" type="date" value={form.reviewDate} onChange={set("reviewDate")} />
            </Field>
            <Field label="Review every" htmlFor="c-interval">
              <Select id="c-interval" value={form.reviewIntervalMonths} onChange={set("reviewIntervalMonths")}>
                <option value="">Not set (12 months)</option>
                {REVIEW_INTERVALS.map((n) => (
                  <option key={n} value={n}>
                    {n} months
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expires" htmlFor="c-expiry" hint="Reminders 60, 30 and 7 days before.">
              <Input id="c-expiry" type="date" value={form.expiryDate} onChange={set("expiryDate")} />
            </Field>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!dirty || pending}>
            Save changes
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => setForm(saved)}>
              Discard
            </Button>
          )}
          {message && (
            <p role="status" className={cn("text-sm", message.tone === "error" ? "text-destructive-ink" : "text-muted-foreground")}>
              {message.text}
            </p>
          )}
        </div>
      </form>

      {labels.length > 0 && (
        <section>
          <SectionHeader>Labels</SectionHeader>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Labels">
            {labels.map((l) => {
              const on = labelIds.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleLabel(l.id)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    on ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:border-border-strong",
                  )}
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: l.color }} aria-hidden="true" />
                  {l.name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {children}

      {(item.project || item.deliverable) && (
        <section>
          <SectionHeader>Came from</SectionHeader>
          <p className="text-sm">
            {item.deliverable && <>Deliverable “{item.deliverable.name}” in </>}
            {item.project ? (
              <Link href={`/projects/${item.project.id}`} className="text-link">
                {item.project.name}
              </Link>
            ) : (
              "a project that's since been deleted"
            )}
            .
          </p>
        </section>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => updateContentItem(item.id, { status: retired ? "published" : "retired" }), retired ? "Restored." : "Retired.")}
        >
          {retired ? <ArchiveRestore className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}
          {retired ? "Restore" : "Retire"}
        </Button>
        {canDelete && (
          <ConfirmDelete
            title="Delete this content record?"
            description="It disappears from the inventory and its history is lost. To stop tracking something that's no longer in use, retire it instead."
            onConfirm={async () => {
              const res = await deleteContentItem(item.id);
              if ("error" in res) return res;
              router.push("/content");
            }}
            trigger={
              <Button variant="ghost" size="sm" className="text-destructive-ink">
                <Trash2 className="size-4" aria-hidden="true" /> Delete
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
