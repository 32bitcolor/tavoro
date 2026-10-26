import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/dal";
import { isInstanceAdmin } from "@/lib/instance";
import { readUpdateStatus } from "@/lib/updater";
import { UpdatePanel } from "@/components/settings/update-panel";

export const metadata = { title: "Updates · Tavoro" };

export default async function UpdatesSettingsPage() {
  // Updating the server affects every workspace on it: instance owner only.
  const me = await getCurrentUser();
  if (!me || !(await isInstanceAdmin(me.id))) redirect("/settings/account");
  const initial = await readUpdateStatus();
  return <UpdatePanel initial={initial} />;
}
