import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * All reads here go through the regular (RLS-governed) server client, not
 * the service-role admin client. The RLS policies already grant admins
 * (role='admin' AND is_active, see is_admin() in 0002_rls.sql) full read
 * access to every table these functions touch — going through RLS keeps a
 * single source of truth for "who can see what" instead of duplicating
 * that logic in application code.
 */

export async function getAllProfiles() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) console.error("getAllProfiles:", error.message);
  return data ?? [];
}

export async function getIntegrationConfigs() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("integration_configs")
    .select("*")
    .order("id", { ascending: true });
  if (error) console.error("getIntegrationConfigs:", error.message);
  return data ?? [];
}

export async function getAllNotifications() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) console.error("getAllNotifications:", error.message);
  return data ?? [];
}

export async function getSystemSettings() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("system_settings")
    .select("*")
    .order("key", { ascending: true });
  if (error) console.error("getSystemSettings:", error.message);
  return data ?? [];
}

export async function getAuditLogs() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) console.error("getAuditLogs:", error.message);
  return data ?? [];
}

export async function getAdminOverviewCounts() {
  const supabase = await createClient();
  const [{ count: userCount }, { count: orderCount }, { count: signalCount }] =
    await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("orders").select("*", { count: "exact", head: true }),
      supabase
        .from("ai_signals")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true),
    ]);
  return {
    userCount: userCount ?? 0,
    orderCount: orderCount ?? 0,
    activeSignalCount: signalCount ?? 0,
  };
}
