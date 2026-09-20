"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/admin/audit";
import { dbErrorMessage } from "@/lib/errors/db-error";
import type {
  InstrumentKind,
  OrderSide,
  SignalCategory,
  SignalSourceKind,
  SignalStatus,
} from "@/types/database";
import { TRADE_CATEGORIES } from "./categories";

/**
 * Signal curation.
 *
 * Release and status changes go through the SECURITY DEFINER functions from
 * migration 0007 rather than a direct UPDATE, because those functions also
 * append the `signal_events` row and the client notification in the same
 * transaction. Doing it in application code would let a signal go live
 * without a lifecycle entry if the second write failed.
 *
 * Server Actions are network-invokable independently of the page that
 * imports them, so every action re-checks admin status itself.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : "Unexpected error." };
}

function revalidateSignalSurfaces(signalId?: string) {
  revalidatePath("/admin/signals");
  revalidatePath("/signals");
  if (signalId) revalidatePath(`/signals/${signalId}`);
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
}

export async function verifySignal(signalId: string, release: boolean): Promise<ActionResult> {
  try {
    const { user } = await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_verify_signal", {
      p_signal_id: signalId,
      p_release: release,
    });
    if (error) return { ok: false, error: error.message };
    await writeAuditLog(user.id, release ? "verify_signal" : "reject_signal", "signals", signalId);
    revalidateSignalSurfaces(signalId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateSignalStatus(
  signalId: string,
  status: SignalStatus,
  detail: string | null
): Promise<ActionResult> {
  try {
    const { user } = await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_update_signal_status", {
      p_signal_id: signalId,
      p_status: status,
      p_detail: detail,
    });
    if (error) return { ok: false, error: error.message };
    await writeAuditLog(user.id, `signal_status:${status}`, "signals", signalId);
    revalidateSignalSurfaces(signalId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export type SignalDraft = {
  sourceId: string;
  symbol: string;
  instrumentKind: InstrumentKind;
  category: SignalCategory;
  direction: OrderSide;
  entryPrice: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  confidence: number | null;
  rationale: string | null;
  riskNote: string | null;
  expiresAt: string | null;
};

/**
 * Manual entry by the desk. Every level is optional and is stored exactly as
 * typed — nothing is derived to fill a gap, so a call published without a
 * second target stays without one instead of gaining an invented level.
 * The row lands `unverified`/`pending` and still has to be released through
 * `verifySignal`, so the same review step applies to desk-entered calls as to
 * ingested ones.
 */
export async function createSignal(draft: SignalDraft): Promise<ActionResult> {
  try {
    const { user } = await requireAdmin();
    const symbol = draft.symbol.trim().toUpperCase();
    if (!symbol) return { ok: false, error: "Symbol is required." };
    if (!draft.sourceId) return { ok: false, error: "A registered source is required." };
    if (!(TRADE_CATEGORIES as SignalCategory[]).includes(draft.category)) {
      return { ok: false, error: "Category must be a trade category (F&O, Equity, or Commodity)." };
    }
    if (
      draft.entryLow !== null &&
      draft.entryHigh !== null &&
      draft.entryLow > draft.entryHigh
    ) {
      return { ok: false, error: "Entry range low must not exceed high." };
    }
    if (draft.confidence !== null && (draft.confidence < 0 || draft.confidence > 100)) {
      return { ok: false, error: "Confidence must be between 0 and 100." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("signals")
      .insert({
        source_id: draft.sourceId,
        symbol,
        instrument_kind: draft.instrumentKind,
        category: draft.category,
        direction: draft.direction,
        entry_price: draft.entryPrice,
        entry_low: draft.entryLow,
        entry_high: draft.entryHigh,
        stop_loss: draft.stopLoss,
        target_1: draft.target1,
        target_2: draft.target2,
        target_3: draft.target3,
        confidence: draft.confidence,
        rationale: draft.rationale,
        risk_note: draft.riskNote,
        expires_at: draft.expiresAt,
        origin_ref: `admin:${user.id}`,
      })
      .select("id")
      .single();
    if (error) {
      return { ok: false, error: dbErrorMessage("createSignal", error, "Could not create the signal.") };
    }

    await supabase.from("signal_events").insert({
      signal_id: data.id,
      event_type: "created",
      actor_id: user.id,
      detail: "Entered manually by the desk.",
    });
    await writeAuditLog(user.id, "create_signal", "signals", data.id);
    revalidateSignalSurfaces();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export type SourceDraft = {
  slug: string;
  name: string;
  kind: SignalSourceKind;
  description: string | null;
  telegramChatId: string | null;
  isTrusted: boolean;
  autoVerify: boolean;
};

export async function upsertSignalSource(
  id: string | null,
  draft: SourceDraft
): Promise<ActionResult> {
  try {
    const { user } = await requireAdmin();
    const slug = draft.slug.trim().toLowerCase();
    if (!slug || !draft.name.trim()) return { ok: false, error: "Slug and name are required." };
    // Mission 8: auto-release is permanently disabled at the database layer
    // (signal_sources_auto_verify_disabled, migration 0028) — every signal,
    // from every source, requires an explicit admin approve/reject. Rejecting
    // here too just gives a clear message instead of a raw constraint error.
    if (draft.autoVerify) {
      return {
        ok: false,
        error: "Auto-verify is disabled platform-wide. Every signal requires explicit admin approval.",
      };
    }

    const supabase = await createClient();
    const row = {
      slug,
      name: draft.name.trim(),
      kind: draft.kind,
      description: draft.description,
      telegram_chat_id: draft.telegramChatId?.trim() || null,
      is_trusted: draft.isTrusted,
      auto_verify: draft.autoVerify,
    };

    const { error } = id
      ? await supabase.from("signal_sources").update(row).eq("id", id)
      : await supabase.from("signal_sources").insert(row);
    if (error) {
      return {
        ok: false,
        error: dbErrorMessage("upsertSignalSource", error, "Could not save the source."),
      };
    }

    await writeAuditLog(user.id, id ? "update_signal_source" : "create_signal_source", "signal_sources", id ?? slug);
    revalidatePath("/admin/signals");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function resolveWorkflowError(id: number): Promise<ActionResult> {
  try {
    const { user } = await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase
      .from("workflow_errors")
      .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: user.id })
      .eq("id", id);
    if (error) {
      return {
        ok: false,
        error: dbErrorMessage("resolveWorkflowError", error, "Could not resolve the error."),
      };
    }
    await writeAuditLog(user.id, "resolve_workflow_error", "workflow_errors", String(id));
    revalidatePath("/admin/signals");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setSignalSourceActive(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    const { user } = await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase
      .from("signal_sources")
      .update({ is_active: isActive })
      .eq("id", id);
    if (error) {
      return {
        ok: false,
        error: dbErrorMessage("setSignalSourceActive", error, "Could not update the source."),
      };
    }
    await writeAuditLog(user.id, isActive ? "enable_signal_source" : "disable_signal_source", "signal_sources", id);
    revalidatePath("/admin/signals");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
