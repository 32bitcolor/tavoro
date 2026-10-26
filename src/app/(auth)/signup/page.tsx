import Link from "next/link";
import { SignupForm } from "@/components/signup-form";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/dal";
import { signupOpen } from "@/lib/instance";

export const metadata = { title: "Create account · Tavoro" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  if (!(await signupOpen())) {
    return (
      <>
        <h2 className="mb-2 text-lg font-medium">Ask your admin for an account</h2>
        <p className="text-sm text-muted-foreground">
          Accounts on this Tavoro are created by a workspace admin, or through your organisation&apos;s single sign-on.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/login" className="underline">
            Back to sign in
          </Link>
        </p>
      </>
    );
  }
  return (
    <>
      <h2 className="mb-4 text-lg font-medium">Create your workspace</h2>
      <SignupForm />
    </>
  );
}
