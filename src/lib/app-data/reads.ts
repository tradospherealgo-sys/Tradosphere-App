import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Read-only data-access helpers shared by the client-app pages. All of
 * these go through the regular (RLS-governed) server client — never the
 * admin client — so a user can only ever see what their own RLS policies
 * allow (own rows, or explicitly public/broadcast rows).
 */

export async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * The tradable universe: identifiers, lot sizes and tick sizes only. This
 * table carries no prices — it exists so the order ticket can size in whole
 * lots and label instruments without guessing.
 */
export async function getTradableInstruments() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("instruments")
    .select("symbol, name, instrument_kind, lot_size, tick_size, is_index, exchange")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("symbol", { ascending: true });
  return data ?? [];
}

export async function getAiAgentVerdicts() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_agent_verdicts")
    .select("*")
    .order("generated_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

export async function getMyNotifications() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  return data ?? [];
}

/** Unread personal notifications. Broadcasts carry no per-user read flag. */
export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_read", false);
  return count ?? 0;
}

export async function getMyWatchlists() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("watchlists")
    .select("*, watchlist_items(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function getMyProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return data ?? null;
}
