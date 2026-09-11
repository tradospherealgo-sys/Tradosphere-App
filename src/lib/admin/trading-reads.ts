import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Admin visibility into the paper-trading engine — orders, positions, and
 * account balances across all users. Same RLS-governed client as the rest
 * of src/lib/admin/reads.ts: the is_admin() branch of each table's policy
 * (0002_rls.sql) is what actually grants this, not a service-role bypass.
 */

export async function getRecentOrders(limit = 50) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*, profiles(email, full_name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) console.error("getRecentOrders:", error.message);
  return data ?? [];
}

export async function getOpenPositions(limit = 100) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("positions")
    .select("*, profiles(email, full_name)")
    .order("opened_at", { ascending: false })
    .limit(limit);
  if (error) console.error("getOpenPositions:", error.message);
  return data ?? [];
}

export async function getAllPaperAccounts() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("paper_accounts")
    .select("*, profiles(email, full_name)")
    .order("updated_at", { ascending: false });
  if (error) console.error("getAllPaperAccounts:", error.message);
  return data ?? [];
}
