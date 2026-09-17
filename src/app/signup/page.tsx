"use client";

import { Suspense, useActionState, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signUpWithPassword, type AuthActionState } from "@/lib/auth/actions";
import { GoogleButton } from "@/components/auth/google-button";
import { BrandMark } from "@/components/brand-mark";

const initialState: AuthActionState = { error: null };

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}

function SignupForm() {
  const [state, formAction, pending] = useActionState(signUpWithPassword, initialState);
  // Shared with GoogleButton below, since Google's OAuth redirect can't
  // carry the invite code through the password-form submission alone.
  const [inviteCode, setInviteCode] = useState("");
  // Set when the callback route rejects a Google signup's invite code (see
  // src/app/auth/callback/route.ts) and deletes the account it just created.
  const oauthError = useSearchParams().get("error");

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandMark className="mx-auto mb-3 size-12" />
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Create your <span className="text-accent">Tradosphere</span> account
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            Start a free simulated portfolio — no real money involved.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-lg shadow-black/20">
          {oauthError && (
            <p className="mb-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-xs text-down">
              {oauthError}
            </p>
          )}
          <div className="mb-5 flex flex-col gap-1.5">
            <label htmlFor="inviteCode" className="text-xs font-medium text-text-muted">
              Invite code
            </label>
            <input
              id="inviteCode"
              type="text"
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoComplete="off"
              placeholder="Required to create an account"
              className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text outline-none focus:border-accent"
            />
          </div>

          <GoogleButton inviteCode={inviteCode} />

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-text-faint">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="inviteCode" value={inviteCode} />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fullName" className="text-xs font-medium text-text-muted">
                Full name
              </label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-xs font-medium text-text-muted">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-xs font-medium text-text-muted">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirmPassword" className="text-xs font-medium text-text-muted">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text outline-none focus:border-accent"
              />
            </div>

            {state.error && <p className="text-xs text-down">{state.error}</p>}

            <button
              type="submit"
              disabled={pending}
              className="mt-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Creating account…" : "Create account"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent-strong hover:underline">
            Sign in
          </Link>
        </p>
        <p className="mt-3 text-center text-xs text-text-faint">
          Educational platform. Simulated trading only — no real money, no
          broker execution.
        </p>
      </div>
    </div>
  );
}
