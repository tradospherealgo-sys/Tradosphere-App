import type { OrderSide } from "@/types/database";

/**
 * Pure P&L / position math for the paper-trading engine. Deliberately has
 * no Supabase or network dependency so it can be unit tested in isolation
 * and reused by both server actions and any future route handlers. All
 * inputs/outputs are plain numbers — this module never fetches or
 * fabricates a price; callers are responsible for supplying a real quote.
 */

export function calcRealizedPnl(params: {
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
}): number {
  const { side, quantity, entryPrice, exitPrice } = params;
  const diff = side === "BUY" ? exitPrice - entryPrice : entryPrice - exitPrice;
  return round2(diff * quantity);
}

export function calcUnrealizedPnl(params: {
  side: OrderSide;
  quantity: number;
  avgPrice: number;
  lastPrice: number;
}): number {
  const { side, quantity, avgPrice, lastPrice } = params;
  const diff = side === "BUY" ? lastPrice - avgPrice : avgPrice - lastPrice;
  return round2(diff * quantity);
}

/**
 * Weighted-average price after adding `addQty` shares/contracts at
 * `addPrice` to an existing position of `existingQty` at `existingAvgPrice`.
 * Used when a new BUY (or SELL, for a short) increases an existing same-side
 * position rather than opening a new one.
 */
export function calcWeightedAveragePrice(params: {
  existingQty: number;
  existingAvgPrice: number;
  addQty: number;
  addPrice: number;
}): number {
  const { existingQty, existingAvgPrice, addQty, addPrice } = params;
  const totalQty = existingQty + addQty;
  if (totalQty <= 0) return 0;
  return round2((existingQty * existingAvgPrice + addQty * addPrice) / totalQty);
}

/**
 * Cash delta for placing an order: negative (cash out) for a BUY, positive
 * (cash in) for a SELL. Does not itself validate sufficient buying power —
 * callers must check cash_balance / margin before committing the order.
 */
export function calcCashDelta(params: {
  side: OrderSide;
  quantity: number;
  price: number;
}): number {
  const { side, quantity, price } = params;
  const notional = round2(quantity * price);
  return side === "BUY" ? -notional : notional;
}

/**
 * Whether a paper account has enough cash to place a BUY order. SELL orders
 * (closing/opening short) are not gated on cash in this simulation-only
 * model — margin rules are intentionally out of scope for V1.
 */
export function hasSufficientCash(params: {
  side: OrderSide;
  quantity: number;
  price: number;
  cashBalance: number;
}): boolean {
  const { side, quantity, price, cashBalance } = params;
  if (side !== "BUY") return true;
  return round2(quantity * price) <= cashBalance;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
