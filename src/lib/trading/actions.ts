"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMarketDataProvider } from "@/lib/market-data";
import type { Database, InstrumentKind, OrderSide } from "@/types/database";

type Order = Database["public"]["Tables"]["orders"]["Row"];
type Position = Database["public"]["Tables"]["positions"]["Row"];
type Trade = Database["public"]["Tables"]["trades"]["Row"];

export type PlaceOrderResult =
  | { ok: true; order: Order }
  | { ok: false; error: string };

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Places a simulated (paper) order for the signed-in user.
 *
 * Never fabricates a fill price: it pulls a real quote from the active
 * market-data provider and rejects the action outright if no real quote is
 * available, rather than falling back to any placeholder, stale or
 * synthetic price.
 *
 * All bookkeeping (order, position, trade, cash-balance) happens atomically
 * inside `place_paper_order`. Since migration 0004 the client has no direct
 * write privilege on any of those tables, so that function is the only path
 * that can move money — it runs `security definer`, derives the account from
 * `auth.uid()` rather than trusting a caller-supplied id, and is the sole
 * holder of the trusted-write flag the table triggers require.
 */
export async function placeOrder(params: {
  symbol: string;
  side: OrderSide;
  quantity: number;
  instrumentKind?: InstrumentKind;
  stopLoss?: number | null;
  targetPrice?: number | null;
  signalId?: string | null;
  notes?: string | null;
}): Promise<PlaceOrderResult> {
  const symbol = params.symbol.trim().toUpperCase();
  const { side, quantity } = params;

  if (!symbol) {
    return { ok: false, error: "Symbol is required." };
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: "Quantity must be a positive number." };
  }
  if (side !== "BUY" && side !== "SELL") {
    return { ok: false, error: "Side must be BUY or SELL." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to place an order." };
  }

  const provider = await getActiveMarketDataProvider();
  const quote = await provider.getQuote(symbol);

  if (!quote) {
    return {
      ok: false,
      error: `No live quote available for ${symbol}. Configure a market-data provider in Admin → Integrations, or try again once the provider is reachable.`,
    };
  }

  // A stop on the wrong side of the fill would be hit instantly, which in a
  // learning tool reads as a broken engine rather than a bad ticket.
  const stopLoss = normalizeLevel(params.stopLoss);
  const targetPrice = normalizeLevel(params.targetPrice);
  const levelError = validateLevels(side, quote.lastPrice, stopLoss, targetPrice);
  if (levelError) return { ok: false, error: levelError };

  const { data: order, error: rpcError } = await supabase.rpc("place_paper_order", {
    p_symbol: symbol,
    p_side: side,
    p_quantity: quantity,
    p_price: quote.lastPrice,
    p_instrument_kind: params.instrumentKind ?? "EQUITY",
    p_quote_source: quote.source,
    p_quote_as_of: quote.asOf,
    p_stop_loss: stopLoss,
    p_target_price: targetPrice,
    p_signal_id: params.signalId ?? null,
    p_notes: params.notes ?? null,
  });

  if (rpcError || !order) {
    return { ok: false, error: rpcError?.message ?? "Order placement failed." };
  }

  revalidateTradingSurfaces();

  if (order.status === "REJECTED") {
    return { ok: false, error: order.reject_reason ?? "Order was rejected." };
  }

  return { ok: true, order };
}

/** Attaches or revises the risk levels on an open position. */
export async function updatePositionRisk(params: {
  positionId: string;
  stopLoss: number | null;
  targetPrice: number | null;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_position_risk", {
    p_position_id: params.positionId,
    p_stop_loss: normalizeLevel(params.stopLoss),
    p_target_price: normalizeLevel(params.targetPrice),
  });

  if (error) return { ok: false, error: error.message };

  revalidateTradingSurfaces();
  return { ok: true };
}

/**
 * Restores the paper account to its starting capital and clears the book.
 * The underlying function can only ever restore `starting_capital` — it
 * cannot be used to set an arbitrary balance.
 */
export async function resetPaperAccount(): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reset_paper_account", {});

  if (error) return { ok: false, error: error.message };

  revalidateTradingSurfaces();
  return { ok: true };
}

function normalizeLevel(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function validateLevels(
  side: OrderSide,
  fillPrice: number,
  stopLoss: number | null,
  targetPrice: number | null
): string | null {
  if (side === "BUY") {
    if (stopLoss !== null && stopLoss >= fillPrice) {
      return `A long stop must sit below the fill price (${fillPrice}).`;
    }
    if (targetPrice !== null && targetPrice <= fillPrice) {
      return `A long target must sit above the fill price (${fillPrice}).`;
    }
    return null;
  }
  if (stopLoss !== null && stopLoss <= fillPrice) {
    return `A short stop must sit above the fill price (${fillPrice}).`;
  }
  if (targetPrice !== null && targetPrice >= fillPrice) {
    return `A short target must sit below the fill price (${fillPrice}).`;
  }
  return null;
}

function revalidateTradingSurfaces() {
  revalidatePath("/paper-trading");
  revalidatePath("/portfolio");
  revalidatePath("/dashboard");
  revalidatePath("/activity");
}

/**
 * Convenience wrapper: closes an existing position at the current market
 * price by placing the opposite-side order for its full quantity. Same
 * "never fabricate a price" contract as placeOrder — it goes through the
 * same code path.
 */
export async function closePosition(positionId: string): Promise<PlaceOrderResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to close a position." };
  }

  const { data: position, error } = await supabase
    .from("positions")
    .select("*")
    .eq("id", positionId)
    .single();

  if (error || !position) {
    return { ok: false, error: "Position not found." };
  }

  const closingSide: OrderSide = position.side === "BUY" ? "SELL" : "BUY";

  return placeOrder({
    symbol: position.symbol,
    side: closingSide,
    quantity: position.quantity,
    instrumentKind: position.instrument_kind,
  });
}

/** Read-only helpers for the Paper Trading / Portfolio pages. */

export async function getMyPositions(): Promise<Position[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("positions")
    .select("*")
    .eq("user_id", user.id)
    .order("opened_at", { ascending: false });

  return data ?? [];
}

export async function getMyOrders(): Promise<Order[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return data ?? [];
}

export async function getMyTrades(): Promise<Trade[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("trades")
    .select("*")
    .eq("user_id", user.id)
    .order("closed_at", { ascending: false })
    .limit(100);

  return data ?? [];
}

export async function getMyPaperAccount() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("paper_accounts")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return data ?? null;
}
