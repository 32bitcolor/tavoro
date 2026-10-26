"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, usableMembershipWhere } from "@/lib/dal";
import { newSecret, normaliseScope, sha256 } from "@/lib/api-tokens";
import { baseUrl, CODE_TTL_MS, redirectAllowed, resourceAllowed } from "@/lib/oauth";
import { findClient } from "@/lib/oauth-cimd";

/** The consent screen's answer. Everything is checked again here: the form is just
 *  the browser repeating what /oauth/authorize was asked. */
export async function decideAuthorization(formData: FormData) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : "";
  };
  const clientId = get("client_id");
  const redirectUri = get("redirect_uri");
  const state = get("state");
  const client = await findClient(clientId);
  // Never redirect anywhere the client didn't register.
  if ("error" in client || !redirectAllowed(client.redirectUris, redirectUri)) redirect("/dashboard");

  const back = new URL(redirectUri);
  if (state) back.searchParams.set("state", state);
  back.searchParams.set("iss", baseUrl());

  if (get("decision") !== "allow") {
    back.searchParams.set("error", "access_denied");
    redirect(back.toString());
  }

  const workspaceId = get("workspace_id");
  const member = await prisma.membership.findFirst({ where: { userId: me.id, workspaceId, ...(await usableMembershipWhere()) }, select: { id: true } });
  const challenge = get("code_challenge");
  if (!member || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !resourceAllowed(get("resource"))) {
    back.searchParams.set("error", "invalid_request");
    redirect(back.toString());
  }

  const code = newSecret("tavc_");
  await prisma.oAuthCode.create({
    data: {
      codeHash: sha256(code),
      clientId,
      userId: me.id,
      workspaceId,
      scope: normaliseScope(get("access")),
      redirectUri,
      codeChallenge: challenge,
      resource: get("resource") || null,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  back.searchParams.set("code", code);
  redirect(back.toString());
}
