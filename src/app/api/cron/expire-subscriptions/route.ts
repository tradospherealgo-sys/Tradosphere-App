import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sweeps subscriptions whose billing period has elapsed and notifies the
 * affected users. Intended for a scheduler (Vercel Cron, GitHub Actions,
 * pg_cron) hitting it on a daily cadence.
 *
 * Entitlement checks already compare `current_period_end` against now(), so
 * access is correct even if this never runs — the sweep exists to move the
 * status column and send the expiry notification, not to enforce access.
 *
 * Auth is a shared secret in the Authorization header. Without CRON_SECRET
 * set the route refuses to run rather than defaulting to open.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 503 }
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();

  // Warn first, then expire. In the other order a subscription that lapses
  // today would be expired and then also warned about, in the same run.
  const warned = await admin.rpc("warn_expiring_subscriptions", { p_days: 3 });
  if (warned.error) {
    return NextResponse.json({ error: warned.error.message }, { status: 500 });
  }

  const expired = await admin.rpc("expire_lapsed_subscriptions");
  if (expired.error) {
    return NextResponse.json({ error: expired.error.message }, { status: 500 });
  }

  return NextResponse.json({ warned: warned.data ?? 0, expired: expired.data ?? 0 });
}
