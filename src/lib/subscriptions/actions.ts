"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/admin/audit";
import { dbErrorMessage } from "@/lib/errors/db-error";
import type { BillingInterval } from "@/types/database";

/**
 * Subscription mutations.
 *
 * Nothing here can mark a payment successful. `record_payment_success` is
 * service-role-only and belongs to a verified gateway webhook; the checkout
 * action below only opens a *pending* payment row, so an abandoned or failed
 * attempt never grants access. Comped access goes through the explicit admin
 * grant, which the database records as source = 'admin_grant'.
 *
 * Server Actions are individually network-invokable, so every admin action
 * re-checks the caller's role rather than relying on the page that imports it.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateBillingSurfaces() {
  revalidatePath("/subscription");
  revalidatePath("/admin/subscriptions");
  revalidatePath("/dashboard");
}

export async function grantSubscription(
  userId: string,
  planId: string
): Promise<ActionResult> {
  const { user } = await requireAdmin();
  if (!userId || !planId) return { ok: false, error: "User and plan are required." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_grant_subscription", {
    p_user_id: userId,
    p_plan_id: planId,
  });
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(user.id, "subscription.grant", "subscriptions", data?.id);
  revalidateBillingSurfaces();
  return { ok: true };
}

export async function cancelSubscription(
  subscriptionId: string
): Promise<ActionResult> {
  const { user } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_cancel_subscription", {
    p_subscription_id: subscriptionId,
  });
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(user.id, "subscription.cancel", "subscriptions", subscriptionId);
  revalidateBillingSurfaces();
  return { ok: true };
}

/**
 * Pauses access without cancelling — reversible, unlike cancel. Used for
 * billing disputes/policy review rather than a permanent end to the plan.
 */
export async function suspendSubscription(
  subscriptionId: string,
  reason: string
): Promise<ActionResult> {
  const { user } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_suspend_subscription", {
    p_subscription_id: subscriptionId,
    p_reason: reason.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(user.id, "subscription.suspend", "subscriptions", subscriptionId);
  revalidateBillingSurfaces();
  return { ok: true };
}

export async function unsuspendSubscription(
  subscriptionId: string
): Promise<ActionResult> {
  const { user } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_unsuspend_subscription", {
    p_subscription_id: subscriptionId,
  });
  if (error) return { ok: false, error: error.message };

  await writeAuditLog(user.id, "subscription.unsuspend", "subscriptions", subscriptionId);
  revalidateBillingSurfaces();
  return { ok: true };
}

export type PlanDraft = {
  slug: string;
  name: string;
  description: string;
  billingInterval: BillingInterval;
  /** Major units as typed by the admin, e.g. "1499.00". Converted to paise. */
  price: string;
  currency: string;
  entitlements: string;
  sortOrder: number;
};

export async function upsertPlan(
  id: string | null,
  draft: PlanDraft
): Promise<ActionResult> {
  const { user } = await requireAdmin();

  const slug = draft.slug.trim().toLowerCase();
  const name = draft.name.trim();
  if (!slug || !name) return { ok: false, error: "Slug and name are required." };
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { ok: false, error: "Slug may contain only lowercase letters, digits and hyphens." };
  }

  const price = Number(draft.price);
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false, error: "Price must be zero or a positive number." };
  }
  // Money is stored as an integer number of paise — never a float.
  const priceMinor = Math.round(price * 100);

  const entitlements = draft.entitlements
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const row = {
    slug,
    name,
    description: draft.description.trim() || null,
    billing_interval: draft.billingInterval,
    price_minor: priceMinor,
    currency: draft.currency.trim().toUpperCase() || "INR",
    entitlements,
    sort_order: draft.sortOrder,
  };

  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("plans").update(row).eq("id", id).select("id").single()
    : await supabase.from("plans").insert(row).select("id").single();
  if (error) {
    return { ok: false, error: dbErrorMessage("upsertPlan", error, "Could not save the plan.") };
  }

  await writeAuditLog(user.id, id ? "plan.update" : "plan.create", "plans", data?.id);
  revalidateBillingSurfaces();
  return { ok: true };
}

export async function setPlanActive(
  id: string,
  isActive: boolean
): Promise<ActionResult> {
  const { user } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("plans")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) {
    return { ok: false, error: dbErrorMessage("setPlanActive", error, "Could not update the plan.") };
  }

  await writeAuditLog(user.id, isActive ? "plan.enable" : "plan.disable", "plans", id);
  revalidateBillingSurfaces();
  return { ok: true };
}

/**
 * Opens a pending payment for the signed-in user and returns its id.
 *
 * This is the whole of the client-side checkout path on purpose. It grants
 * nothing: the row is created 'pending' and only a verified gateway webhook
 * calling `record_payment_success` (service-role only) can turn it into a
 * subscription. Until a gateway is configured this action produces a payment
 * reference the user can quote to the desk, and no access changes hands.
 */
export async function startCheckout(
  planId: string
): Promise<{ ok: true; paymentId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // The amount is read from `plans` inside start_checkout, not passed in —
  // the client never gets to name its own price.
  const { data, error } = await supabase.rpc("start_checkout", {
    p_plan_id: planId,
  });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Plan is not available." };

  revalidatePath("/subscription");
  return { ok: true, paymentId: data.id };
}
