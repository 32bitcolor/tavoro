"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { FolderKanban, Film, Pencil } from "lucide-react";

import { deleteTemplate, updateTemplate, type TemplateSummary } from "@/app/actions/templates";
import { CreateButton } from "@/components/app-shell/quick-create";
import { ConfirmDelete } from "@/components/shared/confirm-delete";
import { ListPanel } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "all", label: "All", href: "/templates" },
  { key: "project", label: "Projects", href: "/templates?kind=project" },
  { key: "storyboard", label: "Storyboards", href: "/templates?kind=storyboard" },
] as const;

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function TemplateList({
  templates,
  filter,
  counts,
}: {
  templates: TemplateSummary[];
  filter: "all" | "project" | "storyboard";
  counts: Record<"all" | "project" | "storyboard", number>;
}) {
  return (
    <>
      <nav aria-label="Template type" className="mt-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={filter === t.key ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm",
              filter === t.key ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label} <span className="tabular-nums text-xs">{counts[t.key]}</span>
          </Link>
        ))}
      </nav>
      {templates.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No templates of this type yet.</p>
      ) : (
        <ListPanel className="mt-4">
          <ul className="divide-y divide-border">
            {templates.map((t) => (
              <TemplateRow key={t.id} t={t} />
            ))}
          </ul>
        </ListPanel>
      )}
    </>
  );
}

function TemplateRow({ t }: { t: TemplateSummary }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const Icon = t.kind === "project" ? FolderKanban : Film;

  function save(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await updateTemplate(t.id, { name: String(fd.get("name") ?? ""), description: String(fd.get("description") ?? "") });
      if ("error" in res) return setError(res.error ?? "Couldn't save.");
      setEditing(false);
    });
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start">
      <Icon className="mt-0.5 hidden size-5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {editing ? (
          <form action={save} className="flex flex-col gap-2">
            <Input name="name" defaultValue={t.name} required maxLength={140} aria-label="Template name" autoFocus />
            <Textarea name="description" defaultValue={t.description ?? ""} rows={2} maxLength={2000} placeholder="What it's for (optional)" aria-label="Template description" className="resize-none" />
            {error && (
              <p role="status" className="text-sm text-destructive-ink">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button size="sm" type="submit" disabled={pending}>
                Save
              </Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium break-words">{t.name}</span>
              <StatusBadge tone="neutral">{t.kind === "project" ? "Project" : "Storyboard"}</StatusBadge>
            </div>
            {t.description && <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{t.description}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {t.summary}
              {" · "}
              {t.createdBy ? `Saved by ${t.createdBy}, ` : "Updated "}
              {fmt(t.updatedAt)}
            </p>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 items-center gap-1">
          <CreateButton kind={t.kind} templateId={t.id} label="Use template" variant="outline" />
          {t.canManage && (
            <>
              <Button size="icon-sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Rename ${t.name}`} title="Rename or describe">
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
              <ConfirmDelete
                title="Delete this template?"
                description="Projects and storyboards already made from it aren't affected."
                confirmLabel="Delete template"
                onConfirm={() => deleteTemplate(t.id)}
                trigger={
                  <Button size="sm" variant="ghost" className="text-destructive-ink hover:bg-destructive/10 hover:text-destructive-ink">
                    Delete
                  </Button>
                }
              />
            </>
          )}
        </div>
      )}
    </li>
  );
}
