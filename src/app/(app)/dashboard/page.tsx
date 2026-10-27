import Link from "next/link";
import { redirect } from "next/navigation";
import {
  FolderKanban,
  Columns3,
  Film,
  ClipboardCheck,
  CalendarClock,
  ArrowRight,
  ArrowUpRight,
  Plus,
  Shield,
  Users,
  ClipboardList,
  ChartColumn,
  Settings,
  LifeBuoy,
} from "lucide-react";

import { requireUser, getActiveMembership } from "@/lib/dal";
import { boardVisibilityWhere, storyboardVisibilityWhere, projectVisibilityWhere } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { NAV_MODULES } from "@/lib/modules";
import { PageContainer, PageHeader, SectionHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";

/** Soft tinted icon chip, theme-safe via color-mix on a semantic token. */
function tint(varName: string) {
  return {
    backgroundColor: `color-mix(in srgb, var(${varName}) 14%, transparent)`,
    color: `var(${varName})`,
  };
}

export const metadata = { title: "Dashboard · Tavoro" };

const PROJECT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
};

function projectTone(status: string): StatusTone {
  if (status === "completed") return "success";
  if (status === "on_hold") return "warning";
  return "info";
}

function formatDue(date: Date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function DashboardPage() {
  const user = await requireUser();
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");

  const isAdmin = membership.role === Role.ADMIN;
  const isManager = membership.role === Role.MANAGER;
  const wsId = membership.workspaceId;

  // Respect group-based access: the dashboard only counts/lists resources the
  // current user is allowed to see.
  const [projectVis, boardVis, storyboardVis] = await Promise.all([
    projectVisibilityWhere(),
    boardVisibilityWhere(),
    storyboardVisibilityWhere(),
  ]);

  const [projects, boardCount, storyboardCount, milestones, myReviews] = await Promise.all([
    prisma.project.findMany({
      where: { workspaceId: wsId, ...projectVis },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        methodology: true,
        status: true,
        phases: { select: { status: true } },
      },
    }),
    prisma.board.count({ where: { workspaceId: wsId, ...boardVis } }),
    prisma.storyboard.count({ where: { workspaceId: wsId, ...storyboardVis } }),
    prisma.milestone.findMany({
      where: { project: { workspaceId: wsId, ...projectVis }, completedAt: null, dueDate: { not: null } },
      orderBy: { dueDate: "asc" },
      take: 5,
      select: { id: true, name: true, dueDate: true, project: { select: { id: true, name: true } } },
    }),
    prisma.reviewCycle.findMany({
      where: {
        reviewerId: user.id,
        status: { in: ["requested", "in_review"] },
        deliverable: { project: { workspaceId: wsId } },
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        roundId: true,
        deliverable: { select: { name: true, project: { select: { id: true, name: true } } } },
      },
    }),
  ]);

  const activeProjects = projects.filter((p) => p.status === "active");

  const stats = [
    { label: "Active projects", value: activeProjects.length, icon: FolderKanban, href: "/projects", tint: "--color-accent" },
    { label: "Boards", value: boardCount, icon: Columns3, href: "/boards", tint: "--color-info" },
    { label: "Storyboards", value: storyboardCount, icon: Film, href: "/storyboards", tint: "--color-success" },
    { label: "Awaiting your review", value: myReviews.length, icon: ClipboardCheck, href: "/my-work", tint: "--color-warning" },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={`Welcome back, ${user.name ?? user.email.split("@")[0]}`}
        description="Here's what's happening across your workspace."
        actions={<StatusBadge tone={isAdmin || isManager ? "info" : "neutral"}>{membership.role}</StatusBadge>}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="group rounded-xl border border-border bg-surface p-5 transition-colors hover:border-border-strong hover:shadow-sm"
          >
            <div className="flex items-start justify-between">
              <div className="flex size-10 items-center justify-center rounded-lg" style={tint(s.tint)}>
                <s.icon className="size-5" />
              </div>
              <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <div className="mt-3 text-2xl font-semibold tabular-nums">{s.value}</div>
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </Link>
        ))}
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-3 [&>*]:min-w-0">
        <section className="lg:col-span-2">
          <SectionHeader
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href="/projects">
                  All projects <ArrowRight className="size-4" />
                </Link>
              </Button>
            }
          >
            Active projects
          </SectionHeader>
          {activeProjects.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="No active projects"
              description="Spin up an ADDIE or SAM project to plan phases, deliverables, and review cycles."
              action={
                <Button asChild size="sm">
                  <Link href="/projects">
                    <Plus className="size-4" /> New project
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              {activeProjects.slice(0, 5).map((p) => {
                const total = p.phases.length;
                const done = p.phases.filter((ph) => ph.status === "done").length;
                const pct = total ? Math.round((done / total) * 100) : 0;
                return (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className="group block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-medium">{p.name}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge tone="neutral">{p.methodology}</StatusBadge>
                        <StatusBadge tone={projectTone(p.status)}>
                          {PROJECT_STATUS_LABEL[p.status] ?? p.status}
                        </StatusBadge>
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {done}/{total} phases done
                        </span>
                        <span className="tabular-nums">{pct}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-8">
          <div>
            <SectionHeader
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/my-work">
                    My Work <ArrowRight className="size-4" />
                  </Link>
                </Button>
              }
            >
              Awaiting your review
            </SectionHeader>
            {myReviews.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                You&rsquo;re all caught up.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {myReviews.map((r) => (
                  <Link
                    key={r.id}
                    href={`/reviews/${r.roundId}`}
                    className="group block rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-strong hover:bg-hover"
                  >
                    <div className="truncate text-sm font-medium">{r.deliverable.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.deliverable.project.name}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div>
            <SectionHeader>Upcoming milestones</SectionHeader>
            {milestones.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No upcoming milestones.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {milestones.map((m) => (
                  <Link
                    key={m.id}
                    href={`/projects/${m.project.id}`}
                    className="group block rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-strong hover:bg-hover"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{m.name}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <CalendarClock className="size-3" />
                        {m.dueDate ? formatDue(m.dueDate) : ""}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{m.project.name}</div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="mt-12">
        <SectionHeader>Jump back in</SectionHeader>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ...NAV_MODULES.filter((m) => m.href).map((m) => ({
              key: m.key,
              href: m.href!,
              icon: m.icon,
              name: m.name,
              tagline: m.tagline,
            })),
            { key: "help", href: "/help", icon: LifeBuoy, name: "Help & guides", tagline: "Getting started, ADDIE & SAM, and how-tos" },
          ].map((m) => (
            <Link
              key={m.key}
              href={m.href}
              className="group flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:shadow-sm"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={tint("--color-accent")}>
                <m.icon className="size-4.5" />
              </div>
              <div className="min-w-0">
                <div className="font-medium">{m.name}</div>
                <p className="text-sm leading-relaxed text-muted-foreground">{m.tagline}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {(isAdmin || isManager) && (
        <section className="mt-12">
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={tint("--color-info")}>
                <Shield className="size-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{isAdmin ? "Admin tools" : "Manager tools"}</div>
                <p className="text-sm text-muted-foreground">
                  {isAdmin
                    ? "You’re a workspace admin — manage your team and account."
                    : "You have oversight access — see what everyone’s working on."}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {isAdmin && (
                    <Button asChild variant="outline" size="sm">
                      <Link href="/settings/members">
                        <Users className="size-4" /> Members &amp; groups
                      </Link>
                    </Button>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link href="/team">
                      <ClipboardList className="size-4" /> Team workload
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/reports">
                      <ChartColumn className="size-4" /> Reports
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/settings/account">
                      <Settings className="size-4" /> Account settings
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </PageContainer>
  );
}
