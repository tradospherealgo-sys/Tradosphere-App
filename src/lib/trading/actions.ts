"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMarketDataProvider } from "@/lib/market-data";
import { shouldFill } from "@/lib/trading/charges";
import type {
  Database,
  InstrumentKind,
  OrderProduct,
  OrderSide,
  OrderVariety,
} from "@/types/database";

type Order = Database["public"]["Tables"]["orders"]["Row"];
type Position = Database["public"]["Tables"]["positions"]["Row"];
type Trade = Database["public"]["Tables"]["trades"]["Row"];

export type PlaceOrderResult =
  | { ok: true; order: Order }
  | { ok: false; error: string };

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * A quote used to fill an order may not be arbitrarily old. Thirty seconds is
 * already generous for a simulated fill; beyond it the "price you traded at"
 * stops resembling the price on screen.
 */
const FILL_QUOTE_MAX_STALE_MS = 30_000;

/**
 * Places a paper order for the signed-in user.
 *
 * Never fabricates a price. A MARKET order requires a live quote and is
 * rejected outright if the provider cannot supply one — there is no fallback
 * to a stale, placeholder or synthesized value. A resting order (LIMIT / SL /
 * SL-M) may be accepted without a quote; it simply waits.
 *
 * All bookkeeping happens atomically inside `place_paper_order`. Since
 * migration 0004 the client has no direct write privilege on orders,
 * positions, trades or paper_accounts, so that function is the only path that
 * can move money: it runs `security definer`, derives the account from
 * `auth.uid()` rather than trusting a caller-supplied id, computes all charges
 * itself, and is the sole holder of the trusted-write flag the table triggers
 * require.
 */
export async function placeOrder(params: {
  symbol: string;
  side: OrderSide;
  quantity: number;
  variety?: OrderVariety;
  product?: OrderProduct;
  limitPrice?: number | null;
  triggerPrice?: number | null;
  instrumentKind?: InstrumentKind;
  stopLoss?: number | null;
  targetPrice?: number | null;
  signalId?: string | null;
  notes?: string | null;
}): Promise<PlaceOrderResult> {
  const symbol = params.symbol.trim().toUpperCase();
  const { side, quantity } = params;
  const variety = params.variety ?? "MARKET";
  const product = params.product ?? "MIS";
  const limitPrice = normalizeLevel(params.limitPrice);
  const triggerPrice = normalizeLevel(params.triggerPrice);

  if (!symbol) {
    return { ok: false, error: "Symbol is required." };
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: "Quantity must be a positive number." };
  }
  if (side !== "BUY" && side !== "SELL") {
    return { ok: false, error: "Side must be BUY or SELL." };
  }

  const shapeError = validateVariety(variety, limitPrice, triggerPrice);
  if (shapeError) return { ok: false, error: shapeError };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to place an order." };
  }

  const provider = await getActiveMarketDataProvider();
  const quote = await provider.getQuote(symbol, { maxStaleMs: FILL_QUOTE_MAX_STALE_MS });

  // A market order is a promise to trade right now; without a real price
  // there is nothing honest to trade at. A resting order is a promise to
  // trade later, so it can be accepted and left pending.
  if (!quote && variety === "MARKET") {
    return {
      ok: false,
      error: `No live quote available for ${symbol}, so a market order cannot be filled at a real price. Configure a market-data provider in Admin → Integrations, or place a limit order instead.`,
    };
  }

  const stopLoss = normalizeLevel(params.stopLoss);
  const targetPrice = normalizeLevel(params.targetPrice);

  // Risk levels are checked against the price the order is expected to fill
  // at, not the live quote: a stop on the wrong side of the *entry* would be
  // hit the instant the order fills.
  const reference =
    variety === "MARKET" ? (quote?.lastPrice ?? null) : (limitPrice ?? triggerPrice);
  if (reference !== null) {
    const levelError = validateLevels(side, reference, stopLoss, targetPrice);
    if (levelError) return { ok: false, error: levelError };
  }

  const { data: order, error: rpcError } = await supabase.rpc("place_paper_order", {
    p_symbol: symbol,
    p_side: side,
    p_quantity: quantity,
    p_variety: variety,
    p_product: product,
    p_price: quote?.lastPrice ?? null,
    p_limit_price: limitPrice,
    p_trigger_price: triggerPrice,
    p_instrument_kind: params.instrumentKind ?? "EQUITY",
    p_quote_source: quote?.source ?? null,
    p_quote_as_of: quote?.asOf ?? null,
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

/** Cancels a resting order and releases any buying power it was holding. */
export async function cancelOrder(orderId: string): Promise<PlaceOrderResult> {
  const supabase = await createClient();
  const { data: order, error } = await supabase.rpc("cancel_paper_order", {
    p_order_id: orderId,
  });

  if (error || !order) {
    return { ok: false, error: error?.message ?? "Could not cancel the order." };
  }

  revalidateTradingSurfaces();
  return { ok: true, order };
}

/**
 * Revises a resting order's quantity or price levels. Omitted fields are left
 * as they are; the database re-reserves buying power against the new terms.
 */
export async function modifyOrder(params: {
  orderId: string;
  quantity?: number | null;
  limitPrice?: number | null;
  triggerPrice?: number | null;
}): Promise<PlaceOrderResult> {
  const supabase = await createClient();
  const { data: order, error } = await supabase.rpc("modify_paper_order", {
    p_order_id: params.orderId,
    p_quantity: normalizeLevel(params.quantity),
    p_limit_price: normalizeLevel(params.limitPrice),
    p_trigger_price: normalizeLevel(params.triggerPrice),
  });

  if (error || !order) {
    return { ok: false, error: error?.message ?? "Could not modify the order." };
  }

  revalidateTradingSurfaces();
  return { ok: true, order };
}

export type MatchResult = {
  /** Orders inspected against a live quote. */
  checked: number;
  filled: number;
  /** Symbols the provider could not price; their orders were left resting. */
  unpriced: string[];
};

/**
 * Order-matching pass over the signed-in user's resting orders.
 *
 * Fetches one real quote per distinct pending symbol and submits only the
 * orders whose trigger condition that quote satisfies. The predicate is
 * re-evaluated inside `execute_pending_order` before anything is booked, so
 * this pass cannot cause a fill the market did not justify — at worst it
 * wastes a round trip. A symbol the provider cannot price yields no fill and
 * no synthesized price; its orders simply stay pending.
 */
export async function processPendingOrders(): Promise<MatchResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { checked: 0, filled: 0, unpriced: [] };

  const { data: pending } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "PENDING");

  if (!pending || pending.length === 0) {
    return { checked: 0, filled: 0, unpriced: [] };
  }

  const provider = await getActiveMarketDataProvider();
  const symbols = Array.from(new Set(pending.map((order) => order.symbol)));
  const quotes = await provider.getQuotes(symbols, {
    maxStaleMs: FILL_QUOTE_MAX_STALE_MS,
  });
  const bySymbol = new Map(quotes.map((quote) => [quote.symbol.toUpperCase(), quote]));

  let filled = 0;
  let checked = 0;

  for (const order of pending) {
    const quote = bySymbol.get(order.symbol.toUpperCase());
    if (!quote) continue;
    checked += 1;

    if (
      !shouldFill(
        order.variety,
        order.side,
        quote.lastPrice,
        order.limit_price,
        order.trigger_price
      )
    ) {
      continue;
    }

    const { data: settled, error } = await supabase.rpc("execute_pending_order", {
      p_order_id: order.id,
      p_price: quote.lastPrice,
      p_quote_source: quote.source,
      p_quote_as_of: quote.asOf,
    });

    // The RPC is a no-op — not an error — when it disagrees, which happens
    // whenever this pass loses a race with the market or another tab. So the
    // returned status, not the absence of an error, is what says a fill
    // happened.
    if (!error && settled?.status === "FILLED") filled += 1;
  }

  if (filled > 0) revalidateTradingSurfaces();

  return {
    checked,
    filled,
    unpriced: symbols.filter((symbol) => !bySymbol.has(symbol.toUpperCase())),
  };
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

/**
 * Closes an existing position at the current market price by placing the
 * opposite-side order for its full quantity. Same "never fabricate a price"
 * contract as placeOrder — it goes through the same code path.
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

  return placeOrder({
    symbol: position.symbol,
    side: position.side === "BUY" ? "SELL" : "BUY",
    quantity: position.quantity,
    product: position.product,
    instrumentKind: position.instrument_kind,
  });
}

function validateVariety(
  variety: OrderVariety,
  limitPrice: number | null,
  triggerPrice: number | null
): string | null {
  if ((variety === "LIMIT" || variety === "SL") && limitPrice === null) {
    return `A ${variety} order needs a positive limit price.`;
  }
  if ((variety === "SL" || variety === "SL_M") && triggerPrice === null) {
    return `A ${variety === "SL_M" ? "SL-M" : "SL"} order needs a positive trigger price.`;
  }
  if (variety === "MARKET" && (limitPrice !== null || triggerPrice !== null)) {
    return "A market order cannot carry a limit or trigger price.";
  }
  return null;
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
      return `A long stop must sit below the entry price (${fillPrice}).`;
    }
    if (targetPrice !== null && targetPrice <= fillPrice) {
      return `A long target must sit above the entry price (${fillPrice}).`;
    }
    return null;
  }
  if (stopLoss !== null && stopLoss <= fillPrice) {
    return `A short stop must sit above the entry price (${fillPrice}).`;
  }
  if (targetPrice !== null && targetPrice >= fillPrice) {
    return `A short target must sit below the entry price (${fillPrice}).`;
  }
  return null;
}

function revalidateTradingSurfaces() {
  revalidatePath("/paper-trading");
  revalidatePath("/portfolio");
  revalidatePath("/dashboard");
  revalidatePath("/activity");
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
