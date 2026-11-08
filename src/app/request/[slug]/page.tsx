import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { IntakeForm } from "./intake-form";
import { readIntakeFields } from "@/lib/intake-fields";

export const metadata = { title: "Submit a request · Tavoro" };

export default async function PublicIntakePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Narrow select — this is the app's one unauthenticated route, so it must never
  // leak anything about the workspace beyond what the form itself needs.
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true, name: true, intakeEnabled: true, intakeFields: true },
  });

  // An address the workspace used before (its link was changed): forward to the
  // current one, so links already shared keep working.
  if (!workspace) {
    const moved = await prisma.workspace.findFirst({ where: { formerSlugs: { has: slug } }, select: { slug: true, intakeEnabled: true } });
    if (moved?.intakeEnabled) redirect(`/request/${moved.slug}`);
  }

  // Same 404 for "no such workspace" and "intake disabled" — a disabled
  // workspace's existence shouldn't be distinguishable from a nonexistent one.
  if (!workspace || !workspace.intakeEnabled) notFound();

  return <IntakeForm workspaceId={workspace.id} workspaceName={workspace.name} fields={readIntakeFields(workspace.intakeFields)} />;
}
