import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretsMatch } from "@/lib/security/secrets";
import { getRawMarketDataProvider } from "@/lib/market-data";
import { getActiveOptionChainProvider } from "@/lib/options";
import type { ProviderTestResult } from "@/lib/market-data/types";

/**
 * Upstox has no refresh token: its session token expires daily and only an
 * interactive login can produce a new one. Automatic refresh is therefore
 * impossible, so the safest thing this route can do is detect the failure
 * promptly and page an admin, rather than let the app quietly serve stale
 * quotes or empty states until someone happens to check /admin/health.
 *
 * Scoped to rows that are actually `provider: 'upstox'` and `is_enabled`.
 * A disabled row or any other provider failing its own testConnection() is
 * an expected, unrelated state (e.g. NoneProvider) and must not alert.
 *
 * Alerts only on a fresh ok -> not-ok transition, not on every run, so a
 * still-broken token doesn't re-page admins on every cron tick. Recovery
 * (not-ok -> ok) is also a transition worth detecting, but this route only
 * needs to stop the pain, not report relief, so it just clears the state by
 * writing the new passing result — the admin already got the one alert
 * that mattered.
 *
 * Vercel Cron only ever issues GET requests to the configured path (it does
 * not support POST), and automatically attaches `Authorization: Bearer
 * <CRON_SECRET>` when that env var is set on the project — see vercel.json.
 * POST is also exposed for manual/other-scheduler invocation with the same
 * header. Both share one handler so the auth and check logic can't drift
 * (same fix already applied to /api/cron/expire-subscriptions).
 */
export const dynamic = "force-dynamic";

const CHECKED_CONFIGS = [
  { id: "market_data_provider" as const, resolve: getRawMarketDataProvider },
  { id: "option_chain_provider" as const, resolve: getActiveOptionChainProvider },
];

async function handleTokenCheck(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 503 }
    );
  }

  const header = request.headers.get("authorization");
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!secretsMatch(presented, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const results: Record<string, ProviderTestResult | null> = {};

  for (const { id, resolve } of CHECKED_CONFIGS) {
    const { data: row } = await admin
      .from("integration_configs")
      .select("provider, is_enabled, last_test_result")
      .eq("id", id)
      .single();

    if (!row || row.provider !== "upstox" || !row.is_enabled) {
      results[id] = null;
      continue;
    }

    const wasOk = (row.last_test_result as ProviderTestResult | null)?.ok !== false;
    const provider = await resolve();
    const result = await provider.testConnection();
    results[id] = result;

    await admin
      .from("integration_configs")
      .update({ last_tested_at: result.testedAt, last_test_result: result })
      .eq("id", id);

    if (wasOk && !result.ok) {
      await notifyAdmins(admin, id, result.message);
    }
  }

  return NextResponse.json({ checked: results });
}

export const GET = handleTokenCheck;
export const POST = handleTokenCheck;

async function notifyAdmins(
  admin: ReturnType<typeof createAdminClient>,
  configId: string,
  message: string
): Promise<void> {
  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .eq("is_active", true);

  if (!admins || admins.length === 0) return;

  const label = configId === "market_data_provider" ? "market data" : "option chain";
  await admin.from("notifications").insert(
    admins.map((a) => ({
      user_id: a.id,
      title: `Upstox ${label} connection failed`,
      body: message,
      kind: "system" as const,
    }))
  );
}
