import Link from "next/link";
import { redirect } from "next/navigation";
import { Library } from "lucide-react";

import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { attentionCounts, listContent } from "@/lib/content-inventory";
import { CONTENT_TYPE_LABEL, formatDay, LIFECYCLE_LABEL, LIFECYCLE_TONE, type ContentType, type Lifecycle } from "@/lib/content";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { LabelPill } from "@/components/shared/work-item";
import { NewContentButton } from "@/components/content/new-content-button";
import { ContentFilters } from "@/components/content/content-filters";
import { cn } from "@/lib/utils";

export const metadata = { title: "Content · Tavoro" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

const TILES: { key: Lifecycle; hint: string }[] = [
  { key: "expired", hint: "past its expiry date" },
  { key: "review_overdue", hint: "review date has passed" },
  { key: "expiring", hint: "expires within 30 days" },
  { key: "review_due", hint: "review due within 30 days" },
];

export default async function ContentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const sp = await searchParams;
  const filters = {
    q: one(sp.q),
    type: one(sp.type),
    status: one(sp.status),
    lifecycle: one(sp.lifecycle),
    ownerId: one(sp.owner),
    labelId: one(sp.label),
  };
  const filtered = Object.values(filters).some(Boolean);

  const [items, counts, members, labels] = await Promise.all([
    listContent(membership.workspaceId, filters),
    attentionCounts(membership.workspaceId),
    prisma.membership.findMany({
      where: { workspaceId: membership.workspaceId, suspendedAt: null },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.label.findMany({ where: { workspaceId: membership.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Content"
        description="Everything your team has shipped, and what needs reviewing or replacing before it goes stale."
        actions={<NewContentButton />}
      />

      {counts.total > 0 && (
        <ul className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Needs attention">
          {TILES.map((t) => {
            const n = counts[t.key];
            const active = filters.lifecycle === t.key;
            return (
              <li key={t.key}>
                <Link
                  href={active ? "/content" : `/content?lifecycle=${t.key}`}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "block rounded-lg border bg-surface px-4 py-3 outline-none transition-colors hover:border-border-strong focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active ? "border-accent" : "border-border",
                  )}
                >
                  <span className={cn("block text-2xl font-semibold tabular-nums", n > 0 && LIFECYCLE_TONE[t.key] === "danger" && "text-destructive-ink", n > 0 && LIFECYCLE_TONE[t.key] === "warning" && "text-warning-ink")}>
                    {n}
                  </span>
                  <span className="block text-sm font-medium">{LIFECYCLE_LABEL[t.key]}</span>
                  <span className="block text-xs text-muted-foreground">{t.hint}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {(counts.total > 0 || filtered) && (
        <div className="mt-6">
          <ContentFilters
            meId={membership.userId}
            members={members.map((m) => ({ id: m.user.id, label: m.user.name ?? m.user.email }))}
            labels={labels}
          />
        </div>
      )}

      {items.length === 0 ? (
        filtered ? (
          <EmptyState className="mt-6" icon={Library} title="Nothing matches" description="Try a different filter, or clear them to see the whole inventory." />
        ) : (
          <EmptyState
            className="mt-8"
            icon={Library}
            title="No content tracked yet"
            description="Add the courses, job aids and videos your team has shipped, with a review date or an expiry date, and Tavoro will tell you before they go stale. From a project, use “Track this” on a finished deliverable."
            action={<NewContentButton />}
          />
        )
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {items.map((it) => (
              <li key={it.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <Link href={`/content/${it.id}`} className="font-medium outline-none hover:underline focus-visible:underline">
                    {it.title}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{CONTENT_TYPE_LABEL[it.contentType as ContentType] ?? it.contentType}</span>
                    {it.owner && <span>· {it.owner.name ?? it.owner.email}</span>}
                    {it.project && <span>· {it.project.name}</span>}
                    {it.labels.map((l) => (
                      <LabelPill key={l.id} label={l} />
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:justify-end">
                  {it.reviewDate && <span>Review {formatDay(it.reviewDate)}</span>}
                  {it.expiryDate && <span>Expires {formatDay(it.expiryDate)}</span>}
                  <StatusBadge tone={LIFECYCLE_TONE[it.lifecycle]}>{LIFECYCLE_LABEL[it.lifecycle]}</StatusBadge>
                </div>
              </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
