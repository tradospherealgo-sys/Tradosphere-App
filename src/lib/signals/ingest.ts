import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSignalMessage } from "./parser";
import { computeSignalFingerprint } from "./fingerprint";
import type { SignalCategory } from "@/types/database";
import type { ParsedSignal } from "./parser";

/**
 * Telegram → inbox → signal.
 *
 * Two rules shape this pipeline:
 *
 *  1. The raw message is persisted *before* any interpretation, so a parser
 *     bug loses nothing and every published number can be traced back to the
 *     text that produced it (`signals.origin_ref` / `signals.raw_message`).
 *  2. A message that cannot be read is recorded as `unparseable` with the
 *     reason. It is never turned into a partial signal with guessed levels,
 *     and never silently dropped — an admin sees it in the inbox.
 *
 * Ingested signals land `unverified`/`pending` and are invisible to clients
 * under the RLS policy in 0007. They are released either by an admin in the
 * Signal Desk or, for a source the desk has explicitly marked trusted +
 * auto-verify, by `admin_verify_signal` running as the service role here.
 */

export type IngestOutcome =
  | { status: "ignored"; reason: string }
  | { status: "duplicate" }
  | { status: "duplicate_signal"; signalId: string }
  | { status: "unparseable"; reason: string }
  | { status: "parsed"; signalId: string; released: boolean };

/** EQUITY stays EQUITY; every option shape this rule-based parser recognises
 *  (INDEX_OPTION/STOCK_OPTION — it never detects COMMODITY) is F&O. */
function categoryForInstrument(instrumentKind: ParsedSignal["instrumentKind"]): SignalCategory {
  return instrumentKind === "EQUITY" ? "EQUITY" : "F&O";
}

export type InboundMessage = {
  chatId: string;
  messageId: number;
  sender: string | null;
  text: string;
  raw: unknown;
};

export async function ingestTelegramMessage(msg: InboundMessage): Promise<IngestOutcome> {
  const admin = createAdminClient();

  const { data: source } = await admin
    .from("signal_sources")
    .select("id, is_active, auto_verify, is_trusted")
    .eq("telegram_chat_id", msg.chatId)
    .maybeSingle();

  const { data: inboxRow, error: inboxError } = await admin
    .from("telegram_inbox")
    .insert({
      chat_id: msg.chatId,
      message_id: msg.messageId,
      sender: msg.sender,
      text: msg.text,
      raw: msg.raw as never,
      source_id: source?.id ?? null,
    })
    .select("id")
    .single();

  // The (chat_id, message_id) unique constraint makes redelivery a no-op —
  // Telegram retries a webhook until it gets a 2xx, so this is expected
  // traffic, not an error.
  if (inboxError) {
    if (inboxError.code === "23505") return { status: "duplicate" };
    throw new Error(inboxError.message);
  }

  const finish = async (
    parseStatus: "parsed" | "unparseable" | "ignored",
    fields: { parse_error?: string | null; signal_id?: string | null } = {}
  ) => {
    await admin
      .from("telegram_inbox")
      .update({ parse_status: parseStatus, ...fields })
      .eq("id", inboxRow.id);
  };

  if (!source || !source.is_active) {
    const reason = source
      ? "Source is registered but disabled."
      : "No registered signal source is bound to this chat.";
    await finish("ignored", { parse_error: reason });
    return { status: "ignored", reason };
  }

  const parsed = parseSignalMessage(msg.text);
  if (!parsed.ok) {
    await finish("unparseable", { parse_error: parsed.reason });
    return { status: "unparseable", reason: parsed.reason };
  }

  const s = parsed.signal;
  const category = categoryForInstrument(s.instrumentKind);
  const fingerprint = computeSignalFingerprint({
    category,
    symbol: s.symbol,
    action: s.direction,
    entry: s.entryPrice ?? s.entryLow,
    stopLoss: s.stopLoss,
    targets: [s.target1, s.target2, s.target3],
  });

  // Same-day resend of an identical call (a desk re-broadcasting, or the same
  // message relayed into more than one bound chat) must not create a second
  // tradeable signal — mirrors the n8n pipeline's fingerprint check.
  const { data: existing } = await admin
    .from("signals")
    .select("id")
    .eq("fingerprint", fingerprint)
    .maybeSingle();
  if (existing) {
    await finish("ignored", { parse_error: "Duplicate signal (same fingerprint).", signal_id: existing.id });
    return { status: "duplicate_signal", signalId: existing.id };
  }

  const { data: signal, error: signalError } = await admin
    .from("signals")
    .insert({
      source_id: source.id,
      symbol: s.symbol,
      instrument_kind: s.instrumentKind,
      category,
      direction: s.direction,
      entry_price: s.entryPrice,
      entry_low: s.entryLow,
      entry_high: s.entryHigh,
      stop_loss: s.stopLoss,
      target_1: s.target1,
      target_2: s.target2,
      target_3: s.target3,
      origin_ref: `telegram:${msg.chatId}:${msg.messageId}`,
      raw_message: msg.text,
      fingerprint,
    })
    .select("id")
    .single();

  if (signalError) {
    // 23505 on the fingerprint unique index means a concurrent request won
    // the same race the pre-check above was trying to avoid — still a
    // duplicate, not a real failure.
    if (signalError.code === "23505") {
      const { data: winner } = await admin
        .from("signals")
        .select("id")
        .eq("fingerprint", fingerprint)
        .maybeSingle();
      if (winner) {
        await finish("ignored", { parse_error: "Duplicate signal (same fingerprint).", signal_id: winner.id });
        return { status: "duplicate_signal", signalId: winner.id };
      }
    }
    await finish("unparseable", { parse_error: `Rejected by database: ${signalError.message}` });
    return { status: "unparseable", reason: signalError.message };
  }

  await admin.from("signal_events").insert({
    signal_id: signal.id,
    event_type: "created",
    detail: "Ingested from Telegram.",
  });

  let released = false;
  if (source.is_trusted && source.auto_verify) {
    // Not `admin_verify_signal` — that one is gated on `auth.uid()`, which the
    // webhook does not have. `system_release_signal` (migration 0011) is
    // service-role-only and re-checks the source's trusted/auto_verify flags
    // itself, so the desk's configuration is the authorisation decision.
    const { error } = await admin.rpc("system_release_signal", {
      p_signal_id: signal.id,
    });
    // A failed auto-release is not a failed ingest: the signal is safely
    // stored as unverified and an admin can still release it by hand.
    released = !error;
  }

  await finish("parsed", { signal_id: signal.id, parse_error: null });
  return { status: "parsed", signalId: signal.id, released };
}

export const __testing = { categoryForInstrument };
