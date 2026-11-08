import { redirect } from "next/navigation";
import { getActiveMembership } from "@/lib/dal";
import { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { IntakeLinkPanel } from "@/components/settings/intake-link-panel";
import { appUrl } from "@/lib/app-url";
import { IntakeFieldsEditor } from "@/components/settings/intake-fields-editor";
import { readIntakeFields } from "@/lib/intake-fields";

export const metadata = { title: "Intake · Tavoro" };

export default async function IntakeSettingsPage() {
  const membership = await getActiveMembership();
  if (!membership || membership.role !== Role.ADMIN) redirect("/settings/account");

  const workspace = await prisma.workspace.findUnique({
    where: { id: membership.workspaceId },
    select: { slug: true, intakeEnabled: true, intakeFields: true },
  });

  // The public address (APP_URL), so the link shown is the one to share whichever
  // hostname the admin is on.
  const origin = (appUrl("/") ?? "").replace(/\/$/, "");
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <IntakeLinkPanel slug={workspace!.slug} intakeEnabled={workspace!.intakeEnabled} origin={origin} />
      <IntakeFieldsEditor initial={readIntakeFields(workspace!.intakeFields)} formUrl={`/request/${workspace!.slug}`} />
    </div>
  );
}
