import { redirect } from "next/navigation";
import { LayoutTemplate } from "lucide-react";

import { getActiveMembership } from "@/lib/dal";
import { listTemplates } from "@/app/actions/templates";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { TemplateList } from "@/components/templates/template-list";

export const metadata = { title: "Templates · Tavoro" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const { kind } = await searchParams;
  const filter = kind === "project" || kind === "storyboard" ? kind : undefined;
  const all = await listTemplates();
  const templates = filter ? all.filter((t) => t.kind === filter) : all;

  return (
    <PageContainer>
      <PageHeader
        title="Templates"
        description="Reusable project skeletons and storyboards. Start a new one from a template instead of rebuilding it."
      />
      {all.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={LayoutTemplate}
          title="No templates yet"
          description="Open a project or storyboard you'd like to reuse and choose Save as template at the bottom of its page."
        />
      ) : (
        <TemplateList templates={templates} filter={filter ?? "all"} counts={{ all: all.length, project: all.filter((t) => t.kind === "project").length, storyboard: all.filter((t) => t.kind === "storyboard").length }} />
      )}
    </PageContainer>
  );
}
