import Link from "next/link";
import { redirect } from "next/navigation";
import { Film, LayoutTemplate } from "lucide-react";

import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { storyboardVisibilityWhere } from "@/lib/authz";
import { STORYBOARD_STATUS_LABEL, type StoryboardStatus } from "@/lib/storyboard";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { CreateButton } from "@/components/app-shell/quick-create";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Storyboards · Tavoro" };

function storyboardTone(status: string): StatusTone {
  if (status === "approved") return "success";
  if (status === "in_review") return "info";
  return "neutral";
}

export default async function StoryboardsPage() {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");

  const storyboards = await prisma.storyboard.findMany({
    where: { workspaceId: membership.workspaceId, ...(await storyboardVisibilityWhere()) },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      _count: { select: { screens: true } },
      deliverable: { select: { id: true, name: true, projectId: true } },
    },
  });

  return (
    <PageContainer>
      <PageHeader
        title="Storyboards"
        description="Screen-by-screen course design, ready for SME review."
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link href="/templates?kind=storyboard">
                <LayoutTemplate className="size-4" aria-hidden="true" />
                Templates
              </Link>
            </Button>
            <CreateButton kind="storyboard" />
          </>
        }
      />

      {storyboards.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={Film}
          title="No storyboards yet"
          description="Create a storyboard to lay out screens, narration, and interaction notes for a course."
        />
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
          {storyboards.map((sb) => (
            <li key={sb.id}>
              <Link href={`/storyboards/${sb.id}`} className="group block h-full">
                <Card className="h-full gap-2 py-4 transition-colors group-hover:border-border-strong">
                  <div className="flex items-start justify-between gap-2 px-5">
                    <span className="line-clamp-2 min-w-0 font-medium" title={sb.title}>{sb.title}</span>
                    <StatusBadge tone={storyboardTone(sb.status)}>
                      {STORYBOARD_STATUS_LABEL[sb.status as StoryboardStatus] ?? sb.status}
                    </StatusBadge>
                  </div>
                  <div className="px-5 text-sm text-muted-foreground">
                    {sb._count.screens} {sb._count.screens === 1 ? "screen" : "screens"}
                    {sb.deliverable ? ` · ${sb.deliverable.name}` : ""}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
