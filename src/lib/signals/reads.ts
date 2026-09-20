import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Signal, SignalSource } from "@/types/database";

/**
 * Client-facing signal reads.
 *
 * These deliberately do no filtering of their own beyond ordering: the
 * "only verified, only released" rule is enforced by RLS in migration 0007,
 * so a bug here cannot leak an unverified call onto a client dashboard.
 * Admin reads that need the full set use the admin client elsewhere.
 */

export type SignalWithSource = Signal & {
  signal_sources: Pick<SignalSource, "slug" | "name" | "kind" | "is_trusted"> | null;
  // Present only on admin reads that opt into it (see admin-reads.ts) — the
  // AI pipeline's raw message + classification, and who reviewed the signal.
  raw_signal_messages?: {
    channel: string;
    sender: string | null;
    raw_text: string;
    ai_category: string | null;
    ai_confidence: number | null;
    ai_extraction: Record<string, unknown> | null;
    ai_model: string | null;
    received_at: string;
  }[];
  reviewer?: { email: string; full_name: string | null } | null;
};

const SOURCE_EMBED =
  "*, signal_sources!inner(slug, name, kind, is_trusted)";

export async function getLiveSignals(limit = 50): Promise<SignalWithSource[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("signals")
    .select(SOURCE_EMBED)
    .in("status", ["active", "triggered"])
    .order("issued_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as SignalWithSource[];
}

/** Everything the user is allowed to see, including closed calls. */
export async function getSignalHistory(limit = 100): Promise<SignalWithSource[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("signals")
    .select(SOURCE_EMBED)
    .order("issued_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as SignalWithSource[];
}

export async function getSignalById(id: string): Promise<SignalWithSource | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("signals")
    .select(SOURCE_EMBED)
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as SignalWithSource) ?? null;
}

export async function getSignalEvents(signalId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("signal_events")
    .select("*")
    .eq("signal_id", signalId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function getSignalSources() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("signal_sources")
    .select("*")
    .order("name", { ascending: true });
  return data ?? [];
}
