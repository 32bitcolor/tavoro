import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { getActiveMembership } from "@/lib/dal";
import { externalSources, impactOf, normalizeSource } from "@/lib/content-impact";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { FlagChangeButton } from "@/components/content/flag-change";
import { PageTitle } from "@/components/app-shell/breadcrumbs";
import { cn } from "@/lib/utils";

export const metadata = { title: "Outside sources · Tavoro" };

/** The policies, systems and regulations the inventory depends on, and "This changed…"
 *  for each: the impact half of the content lifecycle (phase 5). */
export default async function SourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const sp = await searchParams;
  const focus = typeof sp.source === "string" ? normalizeSource(sp.source).toLowerCase() : null;
  const sources = await externalSources(membership.workspaceId);
  const impacts = await Promise.all(sources.map((s) => impactOf(membership.workspaceId, { externalSource: s.name })));

  return (
    <PageContainer>
      <PageTitle title="Outside sources" trail={[{ label: "Content", href: "/content" }]} />
      <PageHeader
        title="Outside sources"
        description="The policies, systems and regulations your content depends on. When one changes, flag everything that relies on it for review in one step."
      />
      {sources.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={ExternalLink}
          title="No outside sources yet"
          description="On a content item, under Dependencies, add “Something outside Tavoro” (a policy, a system, a regulation). Each one appears here."
          action={
            <Link href="/content" className="text-link text-sm">
              Go to Content
            </Link>
          }
        />
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {sources.map((s, i) => (
            <li
              key={s.name}
              id={`src-${i}`}
              className={cn("rounded-lg border bg-surface px-4 py-3", focus === s.name.toLowerCase() ? "border-accent" : "border-border")}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-medium">{s.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {s.items.length} item{s.items.length === 1 ? "" : "s"} depend{s.items.length === 1 ? "s" : ""} on it directly
                    {impacts[i].length > s.items.filter((x) => x.status !== "retired").length ? `, ${impacts[i].length} counting what depends on those` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <FlagChangeButton origin={{ externalSource: s.name }} name={s.name} impact={impacts[i].map((x) => ({ id: x.id, title: x.title, status: x.status, depth: x.depth }))} />
                </div>
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {s.items.map((it) => (
                  <li key={it.id}>
                    <Link href={`/content/${it.id}`} className="hover:underline">
                      {it.title}
                    </Link>
                    {it.status === "retired" && <span className="text-xs text-muted-foreground"> (retired)</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
