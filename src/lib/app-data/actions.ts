"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors/db-error";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function markNotificationRead(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage("markNotificationRead", error, "Could not update the notification."),
    };
  }
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Broadcasts (user_id null) are readable by everyone but owned by nobody,
  // so there is no per-user read flag to set on them — only personal rows.
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", user.id)
    .eq("is_read", false);
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage("markAllNotificationsRead", error, "Could not update notifications."),
    };
  }
  revalidatePath("/notifications");
  return { ok: true };
}

export async function updateProfileName(fullName: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const trimmed = fullName.trim();
  if (!trimmed) return { ok: false, error: "Name cannot be empty." };

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: trimmed })
    .eq("id", user.id);
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage("updateProfileName", error, "Could not update your name."),
    };
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function createWatchlist(name: string): Promise<ActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Watchlist name cannot be empty." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("watchlists")
    .insert({ user_id: user.id, name: trimmed });
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage("createWatchlist", error, "Could not create the watchlist."),
    };
  }
  revalidatePath("/markets");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function addWatchlistItem(
  watchlistId: string,
  symbol: string
): Promise<ActionResult> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return { ok: false, error: "Symbol cannot be empty." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // RLS scopes watchlists to the owner, so a forged watchlistId matches no
  // row and the insert's FK check fails rather than writing to someone else's.
  const { error } = await supabase
    .from("watchlist_items")
    .insert({ watchlist_id: watchlistId, symbol: normalized });
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23505"
          ? `${normalized} is already on this watchlist.`
          : dbErrorMessage("addWatchlistItem", error, "Could not add that symbol."),
    };
  }
  revalidatePath("/markets");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateRiskPerTrade(pct: number): Promise<ActionResult> {
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    return { ok: false, error: "Risk per trade must be between 0 and 100%." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("paper_accounts")
    .update({ risk_per_trade_pct: pct })
    .eq("user_id", user.id);
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage("updateRiskPerTrade", error, "Could not update risk per trade."),
    };
  }
  revalidatePath("/settings");
  return { ok: true };
}
