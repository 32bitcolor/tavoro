"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/dal";
import { hashPassword, verifyPassword } from "@/lib/password";
import { ChangePasswordSchema } from "@/lib/validation";
import { createSession, getSession, sessionsCutoff } from "@/lib/session";
import type { FormState } from "@/lib/form-state";

// Self-service: any signed-in user can change their own password.
export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = ChangePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return { fieldErrors: { confirmPassword: ["Passwords do not match."] } };
  }

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!record || !(await verifyPassword(record.passwordHash, parsed.data.currentPassword))) {
    return { fieldErrors: { currentPassword: ["Current password is incorrect."] } };
  }

  // Sign out every other session, then keep this one.
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword), sessionsValidAfter: sessionsCutoff() },
  });
  const session = await getSession();
  await createSession(user.id, session?.activeWorkspaceId);

  return { success: "Your password has been updated." };
}
