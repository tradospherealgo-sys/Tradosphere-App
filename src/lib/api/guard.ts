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

/**
 * Per-user, per-route sliding-window rate limit for the market-data proxy
 * routes. State lives in module memory, so it resets on cold start and is
 * scoped to a single serverless instance rather than global across the
 * deployment — that makes this a courtesy backstop against one signed-in
 * user hammering the Upstox quota from a single warm instance, not a hard
 * distributed limit. A real multi-instance limit needs a shared store
 * (Redis/Upstash); this is the safe, dependency-free version of the same
 * idea, and it is strictly additive — it never widens what an authenticated
 * user could already do.
 */
const RATE_LIMIT_WINDOW_MS = 10_000;
const hits = new Map<string, number[]>();

/**
 * Returns true if `key` (e.g. `${route}:${userId}`) has made fewer than
 * `limit` calls in the trailing window, and records this call if so.
 */
export function checkRateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }

  recent.push(now);
  hits.set(key, recent);
  return true;
}

/** Ready-to-return 429 response for a route that has exceeded its rate limit. */
export function rateLimitedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please slow down." },
    { status: 429 }
  );
}
