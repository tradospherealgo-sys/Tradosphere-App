"use client";

import { Suspense, useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signInWithPassword, type AuthActionState } from "@/lib/auth/actions";
import { GoogleButton } from "@/components/auth/google-button";
import { BrandMark } from "@/components/brand-mark";

const initialState: AuthActionState = { error: null };

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [state, formAction, pending] = useActionState(signInWithPassword, initialState);
  const params = useSearchParams();
  const checkEmail = params.get("checkEmail");
  const oauthError = params.get("error");

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandMark className="mx-auto mb-3 size-12" />
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Tradosphere <span className="text-accent">Wealth</span>
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            Sign in to your simulation-only trading &amp; research workspace.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-lg shadow-black/20">
          {checkEmail && (
            <p className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-strong">
              Account created. Check your email to confirm before signing in.
            </p>
          )}
          {oauthError && (
            <p className="mb-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-xs text-down">
              {oauthError}
            </p>
          )}

          <GoogleButton />

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-text-faint">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form action={formAction} className="flex flex-col gap-4">
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
                autoComplete="current-password"
                className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text outline-none focus:border-accent"
              />
            </div>

            {state.error && <p className="text-xs text-down">{state.error}</p>}

            <button
              type="submit"
              disabled={pending}
              className="mt-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-text-muted">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-medium text-accent-strong hover:underline">
            Create one
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
