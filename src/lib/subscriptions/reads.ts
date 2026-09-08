import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import type { Payment, Plan, Subscription } from "@/types/database";

/**
 * Subscription and entitlement reads.
 *
 * Entitlements are resolved by the database (`current_entitlements`), not
 * recomputed here, so the answer the UI renders is the same answer RLS uses
 * to allow or deny the underlying rows. A client that lies about its plan
 * still cannot read data it is not entitled to.
 */

export type SubscriptionWithPlan = Subscription & { plans: Plan | null };

export async function getActivePlans(): Promise<Plan[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("price_minor", { ascending: true });
  return data ?? [];
}

/**
 * The caller's live subscription, or null. The period end is re-checked here
 * as well as in SQL so a lapsed row that no sweep has touched yet is never
 * presented as active.
 */
export async function getMySubscription(): Promise<SubscriptionWithPlan | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("subscriptions")
    .select("*, plans(*)")
    .eq("user_id", user.id)
    .in("status", ["trialing", "active", "past_due"])
    .gt("current_period_end", new Date().toISOString())
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function getMySubscriptionHistory(): Promise<SubscriptionWithPlan[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("subscriptions")
    .select("*, plans(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getMyPayments(): Promise<Payment[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("payments")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

export async function getMyEntitlements(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("current_entitlements");
  if (error || !Array.isArray(data)) return [];
  return data;
}

/**
 * Server-side gate for a paid surface. Admins pass everything, matching
 * `has_entitlement` in SQL so the UI and the row policies never disagree.
 */
export async function hasEntitlement(key: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_entitlement", { p_key: key });
  return !error && data === true;
}

// --- Admin ------------------------------------------------------------------

export async function getAllPlans(): Promise<Plan[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("plans")
    .select("*")
    .order("sort_order", { ascending: true });
  return data ?? [];
}

export type SubscriberRow = SubscriptionWithPlan & {
  profiles: { id: string; email: string; full_name: string | null } | null;
};

export async function getAllSubscriptions(limit = 200): Promise<SubscriberRow[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("*, plans(*), profiles!subscriptions_user_id_fkey(id, email, full_name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getAllPayments(limit = 100): Promise<Payment[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
