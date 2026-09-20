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

// Pending-review rows also carry their pipeline provenance: the raw inbound
// message and the AI agent's classification output, so an admin can see
// exactly what the source sent and what the model made of it before
// approving or rejecting. `raw_signal_messages` is n8n's channel-agnostic
// inbox (0019); a manually-entered or legacy-Telegram signal simply has none.
const REVIEW_EMBED =
  "*, signal_sources(slug, name, kind, is_trusted), raw_signal_messages(channel, sender, raw_text, ai_category, ai_confidence, ai_extraction, ai_model, received_at)";

// Released/rejected rows also carry who reviewed them and when, for the
// approval/rejection audit trail (Mission 8, requirement 1).
const REVIEWED_EMBED =
  "*, signal_sources(slug, name, kind, is_trusted), reviewer:profiles!signals_verified_by_fkey(email, full_name)";

export async function getSignalReviewQueue(): Promise<SignalWithSource[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("signals")
    .select(REVIEW_EMBED)
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
    .select(REVIEWED_EMBED)
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

/**
 * Unresolved n8n Signal OS pipeline failures — AI call errors, malformed
 * output, rejected inserts, unreachable destinations. Without this, a stage
 * failure is only visible by reading n8n's own execution logs directly.
 */
export async function getUnresolvedWorkflowErrors(limit = 50) {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("workflow_errors")
    .select("*")
    .eq("resolved", false)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/**
 * Per-destination delivery attempts (Telegram/WhatsApp/dashboard) for
 * published signals — the n8n pipeline writes these on every send, but until
 * now nothing in the app ever read them back.
 */
export async function getRecentDistributionLogs(limit = 50) {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("distribution_logs")
    .select("*, signals(symbol, category)")
    .order("updated_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
