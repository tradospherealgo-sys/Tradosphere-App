import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import type { SignalWithSource } from "./reads";

/**
 * Admin-side signal reads.
 *
 * These see everything, including `pending` and `rejected` rows that RLS
 * hides from clients — that is the point of the review queue. The extra
 * visibility comes from the `is_admin()` branch of the signals policy, not
 * from the service-role client, so an admin whose role is revoked loses it
 * immediately.
 */
const EMBED = "*, signal_sources(slug, name, kind, is_trusted)";

export async function getSignalReviewQueue(): Promise<SignalWithSource[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("signals")
    .select(EMBED)
    .eq("verification_state", "unverified")
    .order("issued_at", { ascending: false })
    .limit(100);
  return (data ?? []) as unknown as SignalWithSource[];
}

export async function getAllSignals(limit = 100): Promise<SignalWithSource[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("signals")
    .select(EMBED)
    .order("issued_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as SignalWithSource[];
}

export async function getAllSignalSources() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("signal_sources")
    .select("*")
    .order("name", { ascending: true });
  return data ?? [];
}

/** Raw inbound Telegram traffic, newest first. Admin-only by RLS. */
export async function getTelegramInbox(limit = 50) {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("telegram_inbox")
    .select("*")
    .order("received_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
