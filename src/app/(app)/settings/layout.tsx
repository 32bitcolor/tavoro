import { redirect } from "next/navigation";
import { getActiveMembership } from "@/lib/dal";
import { isInstanceAdmin } from "@/lib/instance";
import { Role } from "@/generated/prisma/client";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { SettingsNav } from "@/components/settings/settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const isAdmin = membership.role === Role.ADMIN;

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description={isAdmin ? "Your account, and how this workspace runs." : "Your account and connected assistants."}
      />
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[11rem_minmax(0,1fr)]">
        <SettingsNav isAdmin={isAdmin} isInstanceAdmin={isAdmin && (await isInstanceAdmin(membership.userId))} />
        <div className="min-w-0">{children}</div>
      </div>
    </PageContainer>
  );
}
