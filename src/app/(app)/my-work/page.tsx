import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck, Columns3, Flag, Inbox, Library, ListChecks, Send, Shapes } from "lucide-react";

import { prisma } from "@/lib/db";
import { requireUser, getActiveMembership } from "@/lib/dal";
import { projectVisibilityWhere, boardVisibilityWhere, whiteboardVisibilityWhere } from "@/lib/authz";
import { dueMeta, dueToneClass } from "@/lib/due";
import { REVIEW_STATUS_LABEL, type ReviewStatus } from "@/lib/methodology";
import { INTAKE_STATUS_LABEL, OPEN_STATUSES, intakeStatusTone, ticketLabel, type IntakeStatus } from "@/lib/intake";
import { attentionReason, myContentAttention } from "@/lib/content-inventory";
import { LIFECYCLE_LABEL, LIFECYCLE_TONE } from "@/lib/content";
import { SectionHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card } from "@/components/ui/card";
import { ReviewInbox, type InboxReview } from "@/components/my-work/review-inbox";
import { artifactLink, DELIVERABLE_SELECT } from "@/components/my-work/artifact";

export const metadata = { title: "My Work · Tavoro" };

// Reviewer's actionable queue vs. the requester's open loops. Resolved reviews
// (approved / changes-requested) live on the Review History tab.
const REVIEWER_OPEN = ["requested", "in_review"] as const;
const REQUESTER_OPEN = ["requested", "in_review"] as const;

export default async function MyWorkPage() {
  const me = await requireUser();
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const wsId = membership.workspaceId;

  const [projectVis, boardVis, whiteboardVis] = await Promise.all([
    projectVisibilityWhere(),
    boardVisibilityWhere(),
    whiteboardVisibilityWhere(),
  ]);

  const [toReview, requested, cards, subtasks, milestones, myWhiteboards, myRequests, myContent] = await Promise.all([
    prisma.reviewCycle.findMany({
      where: {
        reviewerId: me.id,
        status: { in: [...REVIEWER_OPEN] },
        deliverable: { project: { workspaceId: wsId, ...projectVis } },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, round: true, roundId: true, status: true, dueDate: true, feedback: true,
        requestedBy: { select: { name: true, email: true } },
        deliverable: { select: DELIVERABLE_SELECT },
      },
    }),
    prisma.reviewCycle.findMany({
      where: {
        requestedById: me.id,
        // Guest assignments have no reviewerId — `not: me.id` alone would drop them (SQL NULL).
        OR: [{ reviewerId: { not: me.id } }, { reviewerId: null }],
        status: { in: [...REQUESTER_OPEN] },
        deliverable: { project: { workspaceId: wsId, ...projectVis } },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, status: true, dueDate: true,
        reviewer: { select: { name: true, email: true } },
        guest: { select: { name: true } },
        deliverable: { select: DELIVERABLE_SELECT },
      },
    }),
    prisma.card.findMany({
      where: { assignees: { some: { userId: me.id } }, column: { board: { workspaceId: wsId, ...boardVis } } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true, dueDate: true, column: { select: { name: true, board: { select: { id: true, name: true } } } } },
    }),
    prisma.card.findMany({
      where: {
        parentCardId: { not: null },
        assignees: { some: { userId: me.id } },
        done: false,
        parentCard: { column: { board: { workspaceId: wsId, ...boardVis } } },
      },
      orderBy: [{ dueDate: "asc" }, { id: "desc" }],
      select: {
        id: true, title: true, dueDate: true,
        parentCard: { select: { id: true, title: true, column: { select: { name: true, board: { select: { id: true, name: true } } } } } },
      },
    }),
    prisma.milestone.findMany({
      where: { completedAt: null, dueDate: { not: null }, project: { workspaceId: wsId, ...projectVis } },
      orderBy: { dueDate: "asc" },
      take: 8,
      select: { id: true, name: true, dueDate: true, project: { select: { id: true, name: true } } },
    }),
    // Whiteboards this user owns (created).
    prisma.whiteboard.findMany({
      where: { createdById: me.id, workspaceId: wsId, ...whiteboardVis },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true },
    }),
    // Open intake requests assigned to me.
    prisma.intakeRequest.findMany({
      where: { workspaceId: wsId, assignedToId: me.id, status: { in: [...OPEN_STATUSES] } },
      orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
      select: { id: true, number: true, title: true, status: true, targetDate: true, requesterName: true },
    }),
    // Content I own that's due for review or expiring (lib/content-inventory.ts).
    myContentAttention(me.id, wsId),
  ]);

  const inbox: InboxReview[] = toReview.map((r) => ({
    id: r.id,
    round: r.round,
    roundId: r.roundId,
    status: r.status,
    dueIso: r.dueDate ? r.dueDate.toISOString() : null,
    feedback: r.feedback,
    requestedBy: r.requestedBy?.name ?? r.requestedBy?.email ?? null,
    deliverableName: r.deliverable.name,
    projectName: r.deliverable.project.name,
    projectId: r.deliverable.project.id,
    link: artifactLink(r.deliverable),
  }));

  const totalItems =
    inbox.length + requested.length + myRequests.length + myContent.length + cards.length + subtasks.length + milestones.length + myWhiteboards.length;

  if (totalItems === 0) {
    return (
      <EmptyState
        className="mt-4"
        icon={ClipboardCheck}
        title="You're all caught up"
        description="No open reviews, intake requests, assigned cards or subtasks, upcoming milestones, or whiteboards right now."
      />
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {/* Awaiting my review — interactive */}
      <section>
        <SectionHeader>Awaiting my review · {inbox.length}</SectionHeader>
        {inbox.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing needs your review right now.</p>
        ) : (
          <ReviewInbox reviews={inbox} />
        )}
      </section>

      {/* I'm waiting on — reviews I requested */}
      <section>
        <SectionHeader>I&apos;m waiting on · {requested.length}</SectionHeader>
        {requested.length === 0 ? (
          <p className="text-sm text-muted-foreground">You haven&apos;t requested any open reviews.</p>
        ) : (
          <Card className="divide-y divide-border p-0">
            {requested.map((r) => {
              const link = artifactLink(r.deliverable);
              const due = dueMeta(r.dueDate);
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Send className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-[1_1_12rem]">
                    <Link href={link.href} className="block truncate font-medium hover:underline">
                      {r.deliverable.name}
                    </Link>
                    <div className="truncate text-sm text-muted-foreground">
                      {r.deliverable.project.name} · reviewer: {r.guest ? `${r.guest.name} (guest)` : r.reviewer ? r.reviewer.name ?? r.reviewer.email : "—"}
                    </div>
                  </div>
                  <StatusBadge tone={r.status === "changes_requested" ? "warning" : "info"}>
                    {REVIEW_STATUS_LABEL[r.status as ReviewStatus] ?? r.status}
                  </StatusBadge>
                  {due && <span className={`text-xs ${dueToneClass[due.tone]}`}>{due.label}</span>}
                </div>
              );
            })}
          </Card>
        )}
      </section>

      {/* Intake requests assigned to me — only shown when there are some */}
      {myRequests.length > 0 && (
        <section>
          <SectionHeader>My intake requests · {myRequests.length}</SectionHeader>
          <Card className="divide-y divide-border p-0">
            {myRequests.map((r) => {
              const due = dueMeta(r.targetDate);
              return (
                <Link key={r.id} href={`/intake/${r.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/50">
                  <Inbox className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.title}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {ticketLabel(r.number)} · from {r.requesterName}
                    </div>
                  </div>
                  <StatusBadge tone={intakeStatusTone(r.status)}>{INTAKE_STATUS_LABEL[r.status as IntakeStatus] ?? r.status}</StatusBadge>
                  {due && <span className={`text-xs ${dueToneClass[due.tone]}`}>{due.label}</span>}
                </Link>
              );
            })}
          </Card>
        </section>
      )}

      {/* Content I own that needs a review or a replacement — only shown when there is some */}
      {myContent.length > 0 && (
        <section>
          <SectionHeader>My content to review · {myContent.length}</SectionHeader>
          <Card className="divide-y divide-border p-0">
            {myContent.map((c) => (
              <Link key={c.id} href={`/content/${c.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/50">
                <Library className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.title}</div>
                  <div className="truncate text-sm text-muted-foreground">{attentionReason(c)}</div>
                </div>
                <StatusBadge tone={LIFECYCLE_TONE[c.lifecycle]}>{LIFECYCLE_LABEL[c.lifecycle]}</StatusBadge>
              </Link>
            ))}
          </Card>
        </section>
      )}

      {/* My action items — assigned cards */}
      <section>
        <SectionHeader>My action items · {cards.length}</SectionHeader>
        {cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cards are assigned to you.</p>
        ) : (
          <Card className="divide-y divide-border p-0">
            {cards.map((c) => {
              const due = dueMeta(c.dueDate);
              return (
                <Link key={c.id} href={`/boards/${c.column!.board.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/50">
                  <Columns3 className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.title}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {c.column!.board.name} · {c.column!.name}
                    </div>
                  </div>
                  {due && <span className={`text-xs ${dueToneClass[due.tone]}`}>{due.label}</span>}
                </Link>
              );
            })}
          </Card>
        )}
      </section>

      {/* My subtasks — assigned checklist items */}
      <section>
        <SectionHeader>My subtasks · {subtasks.length}</SectionHeader>
        {subtasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open subtasks are assigned to you.</p>
        ) : (
          <Card className="divide-y divide-border p-0">
            {subtasks.map((s) => {
              const due = dueMeta(s.dueDate);
              return (
                <Link
                  key={s.id}
                  href={`/boards/${s.parentCard!.column!.board.id}?card=${s.parentCard!.id}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/50"
                >
                  <ListChecks className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.title}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {s.parentCard!.column!.board.name} · {s.parentCard!.title}
                    </div>
                  </div>
                  {due && <span className={`text-xs ${dueToneClass[due.tone]}`}>{due.label}</span>}
                </Link>
              );
            })}
          </Card>
        )}
      </section>

      {/* Upcoming milestones */}
      <section>
        <SectionHeader>Upcoming milestones · {milestones.length}</SectionHeader>
        {milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">No milestones coming due.</p>
        ) : (
          <Card className="divide-y divide-border p-0">
            {milestones.map((m) => {
              const due = dueMeta(m.dueDate);
              return (
                <Link key={m.id} href={`/projects/${m.project.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/50">
                  <Flag className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{m.name}</div>
                    <div className="truncate text-sm text-muted-foreground">{m.project.name}</div>
                  </div>
                  {due && <span className={`text-xs ${dueToneClass[due.tone]}`}>{due.label}</span>}
                </Link>
              );
            })}
          </Card>
        )}
      </section>

      {/* My whiteboards — canvases I own */}
      <section>
        <SectionHeader>My whiteboards · {myWhiteboards.length}</SectionHeader>
        {myWhiteboards.length === 0 ? (
          <p className="text-sm text-muted-foreground">You haven&apos;t created any whiteboards.</p>
        ) : (
          <Card className="divide-y divide-border p-0">
            {myWhiteboards.map((w) => (
              <Link key={w.id} href={`/whiteboards/${w.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/50">
                <Shapes className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{w.title}</div>
                </div>
              </Link>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
