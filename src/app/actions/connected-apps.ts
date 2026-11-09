"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getWorkspaceAdmin } from "@/lib/dal";
import { seal } from "@/lib/secret-box";
import { KINDS, connectionKey, newClientId, newSecret, normaliseAppUrl } from "@/lib/connected-apps";

// Settings → Connected apps (docs/SUITE.md). Admins only, in the browser only.

/** Connect an app; returns the connection key, shown once. */
export async function connectApp(rawUrl: string, kind: keyof typeof KINDS = "courseforge") {
  const m = await getWorkspaceAdmin();
  if (!m) return { error: "Only workspace admins can connect apps." };
  const url = normaliseAppUrl(rawUrl);
  if (!url) return { error: "Enter the app’s web address, starting with https://." };
  if (!(kind in KINDS)) return { error: "Unknown kind of app." };
  if (await prisma.connectedApp.findFirst({ where: { workspaceId: m.workspaceId, url } })) {
    return { error: "That app is already connected. To get a new key, disconnect it and connect it again." };
  }
  const clientId = newClientId();
  const secret = newSecret();
  await prisma.connectedApp.create({
    data: { workspaceId: m.workspaceId, kind, name: KINDS[kind], url, clientId, secretSealed: seal(secret), secretHint: secret.slice(-4), createdById: m.userId },
  });
  revalidatePath("/settings/apps");
  revalidatePath("/", "layout"); // the sidebar's app switcher
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? "http";
  const base = process.env.APP_URL?.replace(/\/+$/, "") || `${proto}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  return { ok: true as const, key: connectionKey(base, clientId, secret) };
}

export async function disconnectApp(id: string) {
  const m = await getWorkspaceAdmin();
  if (!m) return { error: "Only workspace admins can disconnect apps." };
  await prisma.connectedApp.deleteMany({ where: { id, workspaceId: m.workspaceId } });
  revalidatePath("/settings/apps");
  revalidatePath("/", "layout");
  return { ok: true as const };
}
