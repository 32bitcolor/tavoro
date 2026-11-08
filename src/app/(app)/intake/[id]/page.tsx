import { readAnswers } from "@/lib/intake-fields";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveMembership, requireUser } from "@/lib/dal";
import { getIntakeRequestForUser } from "@/lib/authz";
import { canDecideIntake, canWorkIntake } from "@/lib/intake";
import { statusPath, statusUrl } from "@/lib/intake-status";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { RequestDetail } from "@/components/intake/request-detail";

export const metadata = { title: "Request · Tavoro" };

export default async function IntakeRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const decide = canDecideIntake(membership.role);

  const { id } = await params;
  const request = await getIntakeRequestForUser(id);
  if (!request) notFound();

  const [members, decidedBy, messages] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId: membership.workspaceId, suspendedAt: null },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
    request.decidedById
      ? prisma.user.findUnique({ where: { id: request.decidedById }, select: { name: true, email: true } })
      : Promise.resolve(null),
    prisma.intakeMessage.findMany({
      where: { requestId: request.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, kind: true, fromRequester: true, body: true, createdAt: true, author: { select: { name: true, email: true } } },
    }),
  ]);
  // The requester's status page link is for whoever can work the request.
  const showStatusLink = canWorkIntake(membership.role, me.id, request.assignedToId);

  return (
    <PageContainer size="wide">
      <PageHeader title={request.title} />
      <div className="mt-6">
        <RequestDetail
          request={{
            id: request.id,
            number: request.number,
            title: request.title,
            description: request.description,
            requesterName: request.requesterName,
            // Requester emails are for admins and managers only.
            requesterEmail: decide ? request.requesterEmail : null,
            targetAudience: request.targetAudience,
            answers: readAnswers(request.answers),
            targetDate: request.targetDate?.toISOString() ?? null,
            impactScore: request.impactScore,
            effortScore: request.effortScore,
            status: request.status,
            assignedToId: request.assignedToId,
            rejectionReason: request.rejectionReason,
            convertedProjectId: request.convertedProjectId,
            decidedAt: request.decidedAt?.toISOString() ?? null,
            decidedBy: decidedBy ? (decidedBy.name ?? decidedBy.email) : null,
            createdAt: request.createdAt.toISOString(),
          }}
          members={members.map((m) => m.user)}
          viewer={{ id: me.id, role: membership.role, decide }}
          messages={messages.map((m) => ({
            id: m.id,
            kind: m.kind === "note" ? "note" : "reply",
            fromRequester: m.fromRequester,
            author: m.fromRequester ? request.requesterName : m.author ? (m.author.name ?? m.author.email) : "The team",
            body: m.body,
            at: m.createdAt.toISOString(),
          }))}
          statusUrl={showStatusLink ? (statusUrl(request) ?? statusPath(request)) : null}
        />
      </div>
    </PageContainer>
  );
}
