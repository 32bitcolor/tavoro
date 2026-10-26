import { z } from "zod";

export const SignupSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  email: z.email("Please enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(256, "Password must be 256 characters or fewer."),
  workspaceName: z.string().trim().min(2, "Workspace name must be at least 2 characters."),
});

export const LoginSchema = z.object({
  email: z.email("Please enter a valid email."),
  password: z.string().min(1, "Password is required.").max(256),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z.string().min(8, "New password must be at least 8 characters.").max(256, "Password must be 256 characters or fewer."),
  confirmPassword: z.string().min(1, "Confirm your new password."),
});

// Admin creating a workspace member. Password is set by the admin and shared
// out-of-band (no email system). Name optional; email is the login.
export const CreateUserSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.email("Please enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(256, "Password must be 256 characters or fewer."),
  role: z.enum(["ADMIN", "MANAGER", "MEMBER"]),
});

export const ResetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters.").max(256, "Password must be 256 characters or fewer."),
});

export const GroupSchema = z.object({
  name: z.string().trim().min(1, "Group name is required.").max(80),
  description: z.string().trim().max(280).optional(),
});
