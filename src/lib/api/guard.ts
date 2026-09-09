import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Shared entry check for market-data route handlers.
 *
 * These routes proxy a provider the user has no credentials for — the whole
 * point of the abstraction is that the secret stays server-side. That makes
 * them a resource worth gating: an open quote endpoint is a free rate-limit
 * budget for anyone who finds the URL, and burning it takes the feed down for
 * real users.
 *
 * Returns the user on success, or a ready-to-return NextResponse on failure,
 * so a handler reads as `if ("response" in gate) return gate.response;`.
 */
export async function requireUser(): Promise<
  { user: { id: string; email: string | null } } | { response: NextResponse }
> {
  const { user, profile } = await getCurrentUser();

  if (!user) {
    return {
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 }),
    };
  }

  // A deactivated account keeps a valid session cookie until it expires;
  // authorization has to be re-checked here, not just at sign-in.
  if (!profile?.is_active) {
    return {
      response: NextResponse.json({ error: "Account is not active." }, { status: 403 }),
    };
  }

  return { user };
}

/** Parses `?symbols=A,B,C` into a bounded, de-duplicated, upper-cased list. */
export function parseSymbols(raw: string | null, max = 25): string[] {
  if (!raw) return [];
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(symbols)).slice(0, max);
}
