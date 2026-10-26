"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login } from "@/app/actions/auth";
import type { AuthState } from "@/lib/form-state";

const inputClass =
  "w-full rounded-md border border-border-strong bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/60";

/** `next`: a same-site path to return to after signing in (e.g. an OAuth consent page). */
export function LoginForm({ next, email, signupOpen = false }: { next?: string; email?: string; signupOpen?: boolean }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(login, undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Email</span>
        <input name="email" type="email" defaultValue={email} className={inputClass} placeholder="you@example.com" autoComplete="email" />
        {state?.fieldErrors?.email?.[0] && (
          <span className="text-xs text-red-600">{state.fieldErrors.email[0]}</span>
        )}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Password</span>
        <input name="password" type="password" className={inputClass} autoComplete="current-password" />
        {state?.fieldErrors?.password?.[0] && (
          <span className="text-xs text-red-600">{state.fieldErrors.password[0]}</span>
        )}
      </label>

      {state?.error && <p className="text-sm text-destructive-ink">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {/* A real page navigation to /api/sso/start, so the browser follows the redirect on
          to the identity provider (a server action's fetch can't; docs/SSO.md). Only the
          email and return path go in the URL — never the password field. */}
      <button
        type="button"
        onClick={(e) => {
          const email = (e.currentTarget.form?.elements.namedItem("email") as HTMLInputElement | null)?.value ?? "";
          const q = new URLSearchParams({ email: email.trim(), ...(next ? { next } : {}) });
          // A full page load on purpose: router.push would fetch, and stop at the IdP.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign(`/api/sso/start?${q}`);
        }}
        className="-mt-2 rounded-md border border-border-strong px-4 py-2 text-sm font-medium"
      >
        Sign in with SSO
      </button>

      {signupOpen && (
        <p className="text-center text-sm text-muted-foreground">
          Need an account?{" "}
          <Link href="/signup" className="underline">
            Create one
          </Link>
        </p>
      )}
    </form>
  );
}
