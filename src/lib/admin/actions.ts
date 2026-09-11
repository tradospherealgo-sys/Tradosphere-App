"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMarketDataProvider } from "@/lib/market-data";
import { getActiveOptionChainProvider } from "@/lib/options";
import { requireAdmin } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/admin/audit";
import { dbErrorMessage } from "@/lib/errors/db-error";
import type { AppRole, NotificationKind } from "@/types/database";

const NOTIFICATION_KINDS: NotificationKind[] = [
  "system",
  "trade",
  "signal",
  "education",
  "announcement",
];

export type ActionResult = { ok: true } | { ok: false; error: string };

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Server Actions are directly invokable over the network regardless of
 * whether the admin page/layout that references them was ever rendered to
 * the caller, so the layout's redirect() is not itself an auth boundary —
 * every exported action here must check admin status explicitly rather
 * than relying solely on RLS (which only protects the eventual DB write,
 * not any network/side effect performed before it).
 */
async function ensureAdmin(): Promise<ActionResult | null> {
  try {
    await requireAdmin();
    return null;
  } catch {
    return { ok: false, error: "Forbidden: admin role required." };
  }
}

export async function setUserRole(userId: string, role: AppRole): Promise<ActionResult> {
  const guard = await ensureAdmin();
  if (guard) return guard;
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) {
    return { ok: false, error: dbErrorMessage("setUserRole", error, "Could not update the role.") };
  }
  const actor = await currentUserId();
  if (actor) await writeAuditLog(actor, `set_role:${role}`, "profiles", userId);
  revalidatePath("/admin/clients");
  return { ok: true };
}

export async function setUserActive(userId: string, isActive: boolean): Promise<ActionResult> {
  const guard = await ensureAdmin();
  if (guard) return guard;
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: isActive })
    .eq("id", userId);
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage("setUserActive", error, "Could not update account status."),
    };
  }
  const actor = await currentUserId();
  if (actor) {
    await writeAuditLog(actor, isActive ? "activate_user" : "deactivate_user", "profiles", userId);
  }
  revalidatePath("/admin/clients");
  return { ok: true };
}

export async function updateIntegrationConfig(params: {
  id: string;
  provider: string;
  isEnabled: boolean;
  config: Record<string, unknown>;
  secretEnvVar: string | null;
}): Promise<ActionResult> {
  const guard = await ensureAdmin();
  if (guard) return guard;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("integration_configs")
    .update({
      provider: params.provider,
      is_enabled: params.isEnabled,
      config: params.config,
      secret_env_var: params.secretEnvVar,
      updated_by: user.id,
    })
    .eq("id", params.id);
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage("updateIntegrationConfig", error, "Could not save the configuration."),
    };
  }
  await writeAuditLog(user.id, "update_integration_config", "integration_configs", params.id);
  revalidatePath("/admin/integrations");
  return { ok: true };
}

/**
 * Runs the real provider's testConnection() (never a canned "success") and
 * persists the result so the admin UI can show when it was last verified.
 */
export async function testIntegrationConnection(
  id: "market_data_provider" | "option_chain_provider"
): Promise<ActionResult & { message?: string }> {
  const guard = await ensureAdmin();
  if (guard) return guard;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const provider =
    id === "market_data_provider"
      ? await getActiveMarketDataProvider()
      : await getActiveOptionChainProvider();
  const result = await provider.testConnection();

  const { error } = await supabase
    .from("integration_configs")
    .update({ last_tested_at: result.testedAt, last_test_result: result })
    .eq("id", id);
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage("testIntegrationConnection", error, "Could not save the test result."),
    };
  }

  revalidatePath("/admin/integrations");
  return result.ok
    ? { ok: true, message: result.message }
    : { ok: false, error: result.message };
}

export async function sendNotification(params: {
  title: string;
  body: string;
  kind: string;
  userId: string | null;
}): Promise<ActionResult> {
  const guard = await ensureAdmin();
  if (guard) return guard;
  const trimmedTitle = params.title.trim();
  if (!trimmedTitle) return { ok: false, error: "Title is required." };
  if (!NOTIFICATION_KINDS.includes(params.kind as NotificationKind)) {
    return { ok: false, error: "Invalid notification kind." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("notifications").insert({
    title: trimmedTitle,
    body: params.body.trim() || null,
    kind: params.kind as NotificationKind,
    user_id: params.userId,
  });
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage("sendNotification", error, "Could not send the notification."),
    };
  }
  const actor = await currentUserId();
  if (actor) await writeAuditLog(actor, "send_notification", "notifications");
  revalidatePath("/admin/notifications");
  return { ok: true };
}

export async function updateSystemSetting(key: string, rawValue: string): Promise<ActionResult> {
  const guard = await ensureAdmin();
  if (guard) return guard;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return { ok: false, error: "Value must be valid JSON (e.g. \"text\", 42, true)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("system_settings")
    .update({ value: parsed, updated_by: user.id })
    .eq("key", key);
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage("updateSystemSetting", error, "Could not update the setting."),
    };
  }
  await writeAuditLog(user.id, "update_system_setting", "system_settings", key);
  revalidatePath("/admin/settings");
  return { ok: true };
}
