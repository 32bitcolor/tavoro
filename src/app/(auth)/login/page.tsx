import { LoginForm } from "@/components/login-form";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/dal";
import { signupOpen } from "@/lib/instance";
import { safeNextPath } from "@/lib/safe-next";

export const metadata = { title: "Sign in · Tavoro" };

// Why a single sign-on attempt came back here (docs/SSO.md).
const SSO_ERRORS: Record<string, string> = {
  unavailable: "Single sign-on isn't available for that workspace right now.",
  invalid: "The sign-in from your identity provider couldn't be verified. Try again, or ask your admin.",
  noemail: "Your identity provider didn't send an email address. Ask your admin to check the SSO app's attributes.",
  suspended: "Your access to this workspace has been turned off. Ask your workspace admin.",
  notprovisioned: "You don't have a Tavoro account in this workspace yet. Ask your admin to give you access.",
  noaddress: "Enter your work email, then choose “Sign in with SSO”.",
  nodomain: "Single sign-on isn't set up for that email's domain.",
  elsewhere: "Your account is also in another Tavoro workspace, so sign in with your email and password instead.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; sso?: string; email?: string }> }) {
  const { next, sso, email } = await searchParams;
  if (await getCurrentUser()) redirect(safeNextPath(next) ?? "/dashboard");
  return (
    <>
      <h2 className="mb-4 text-lg font-medium">Sign in</h2>
      {typeof sso === "string" && SSO_ERRORS[sso] && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{SSO_ERRORS[sso]}</p>}
      <LoginForm next={typeof next === "string" ? next : undefined} email={typeof email === "string" ? email : undefined} signupOpen={await signupOpen()} />
    </>
  );
}
