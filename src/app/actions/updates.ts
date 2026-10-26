"use server";

import { getCurrentUser } from "@/lib/dal";
import { isInstanceAdmin } from "@/lib/instance";
import { currentPrincipal } from "@/lib/principal";
import { readUpdateStatus, writeUpdateRequest, type UpdateStatus } from "@/lib/updater";

// Updating or rolling back the server affects every workspace on it, so only the
// instance owner may, and never through an MCP token.
async function requireInstanceAdmin() {
  const me = await getCurrentUser();
  if (currentPrincipal() || !me || !(await isInstanceAdmin(me.id))) throw new Error("Forbidden");
}

export async function getUpdateStatus(): Promise<UpdateStatus | null> {
  await requireInstanceAdmin();
  return readUpdateStatus();
}

export async function checkForUpdates() {
  await requireInstanceAdmin();
  await writeUpdateRequest("check");
  return { ok: true };
}

export async function applyUpdate() {
  await requireInstanceAdmin();
  await writeUpdateRequest("update");
  return { ok: true };
}

export async function rollbackUpdate() {
  await requireInstanceAdmin();
  await writeUpdateRequest("rollback");
  return { ok: true };
}
