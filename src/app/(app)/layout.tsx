import { requireUser, getActiveMembership } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { projectVisibilityWhere, boardVisibilityWhere } from "@/lib/authz";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { suiteLinks } from "@/lib/connected-apps";
import { Breadcrumbs, PageTitleProvider } from "@/components/app-shell/breadcrumbs";
import { CommandPalette } from "@/components/app-shell/command-palette";
import { QuickCreate } from "@/components/app-shell/quick-create";
import { NotificationsBadge } from "@/components/app-shell/notifications-badge";
import { IntakeBadge } from "@/components/app-shell/intake-badge";
import { UpdatePill } from "@/components/app-shell/update-pill";
import { readUpdateStatus } from "@/lib/updater";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Centralized auth gate for every module in the (app) group.
  const user = await requireUser();
  const membership = await getActiveMembership();
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id, suspendedAt: null },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true, workspace: { select: { name: true } } },
  });

  const isAdmin = membership?.role === "ADMIN";
  // MANAGER is an oversight role: sees the Team workload view like ADMIN does,
  // but doesn't get ADMIN's user/group/workspace-settings management.
  const canViewTeam = isAdmin || membership?.role === "MANAGER";

  const [awaitingReviewCount, needsTriageCount, myOpenSubtasksCount, updateStatus] = await Promise.all([
    membership
      ? prisma.reviewCycle.count({
          where: {
            reviewerId: user.id,
            status: { in: ["requested", "in_review"] },
            deliverable: { project: { workspaceId: membership.workspaceId, ...(await projectVisibilityWhere()) } },
          },
        })
      : Promise.resolve(0),
    membership
      ? prisma.intakeRequest.count({
          // Admins and managers: everything awaiting triage. Members: what's assigned to them.
          where: canViewTeam
            ? { workspaceId: membership.workspaceId, status: { in: ["submitted", "triaging"] } }
            : { workspaceId: membership.workspaceId, assignedToId: user.id, status: { in: ["submitted", "triaging", "needs_info"] } },
        })
      : Promise.resolve(0),
    membership
      ? prisma.card.count({
          where: {
            parentCardId: { not: null },
            assignees: { some: { userId: user.id } },
            done: false,
            parentCard: { column: { board: { workspaceId: membership.workspaceId, ...(await boardVisibilityWhere()) } } },
          },
        })
      : Promise.resolve(0),
    isAdmin ? readUpdateStatus() : Promise.resolve(null),
  ]);
  const suiteApps = membership ? await suiteLinks(membership.workspaceId) : [];

  return (
    <SidebarProvider>
      <AppSidebar
        workspaceName={membership?.workspace.name ?? "No workspace"}
        userLabel={user.name ?? user.email}
        userEmail={user.email}
        role={membership?.role ?? "—"}
        isAdmin={isAdmin}
        canViewTeam={canViewTeam}
        workspaces={memberships.map((m) => ({ id: m.workspaceId, name: m.workspace.name }))}
        activeWorkspaceId={membership?.workspaceId ?? null}
        suiteApps={suiteApps}
      />
      <SidebarInset>
        <PageTitleProvider>
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            {/* Phones show the page title in the page itself; the crumbs would only
                crowd the header past the viewport. */}
            <div className="hidden min-w-0 flex-1 overflow-hidden sm:block">
              <Breadcrumbs />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {updateStatus && <UpdatePill initialCount={updateStatus.behind} />}
              <CommandPalette />
              <IntakeBadge count={needsTriageCount} />
              <NotificationsBadge count={awaitingReviewCount + myOpenSubtasksCount} />
              <QuickCreate />
            </div>
          </header>
          <div className="min-w-0 flex-1">{children}</div>
        </PageTitleProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
