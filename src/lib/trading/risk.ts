/**
 * Pure risk / position-sizing math.
 *
 * Same contract as pnl.ts: no network, no Supabase, plain numbers in and
 * out, so it can be unit tested and shared between the order ticket (which
 * runs in the browser) and any server-side validation.
 *
 * Everything here is derived from numbers the caller already has — an
 * account balance, a real quoted price, and a stop the user chose. Nothing
 * is estimated or defaulted on the user's behalf: if the stop is missing,
 * sizing returns null rather than inventing a risk figure.
 */

export type SizingInput = {
  /** Capital the risk percentage applies to. */
  equity: number;
  /** Percent of equity to risk on this trade, e.g. 1.5. */
  riskPct: number;
  entryPrice: number;
  stopLoss: number;
  /** Contract multiplier. 1 for cash equity, the lot size for F&O. */
  lotSize?: number;
};

export type SizingResult = {
  /** Currency amount at risk if the stop is hit. */
  riskAmount: number;
  /** Per-unit distance between entry and stop. */
  riskPerUnit: number;
  /** Tradeable quantity, floored to whole lots. */
  quantity: number;
  /** Whole lots, for F&O where the ticket is expressed in lots. */
  lots: number;
  /** Cash required to open, at the quoted entry. */
  notional: number;
  /** Actual risk once quantity is rounded down to a whole lot. */
  actualRisk: number;
};

/**
 * Returns null when the inputs cannot produce a real number — a zero or
 * inverted stop distance, non-positive equity, or a risk percentage outside
 * a sane band. A null result is what the UI renders as "set a stop to size
 * this trade", which is preferable to showing a confident-looking quantity
 * derived from a degenerate input.
 */
export function calcPositionSize(input: SizingInput): SizingResult | null {
  const { equity, riskPct, entryPrice, stopLoss } = input;
  const lotSize = input.lotSize && input.lotSize > 0 ? input.lotSize : 1;

  if (!isPositive(equity) || !isPositive(entryPrice) || !isPositive(stopLoss)) return null;
  if (!Number.isFinite(riskPct) || riskPct <= 0 || riskPct > 100) return null;

  const riskPerUnit = round2(Math.abs(entryPrice - stopLoss));
  if (riskPerUnit <= 0) return null;

  const riskAmount = round2((equity * riskPct) / 100);
  const lots = Math.floor(riskAmount / (riskPerUnit * lotSize));

  // Below one lot the trade cannot be taken at this risk budget. Reporting
  // zero (rather than rounding up to one) keeps the risk rule honest.
  const quantity = lots * lotSize;

  return {
    riskAmount,
    riskPerUnit,
    quantity,
    lots,
    notional: round2(quantity * entryPrice),
    actualRisk: round2(quantity * riskPerUnit),
  };
}

/**
 * Reward-to-risk ratio. Null unless entry, stop and target are all present
 * and the stop sits on the correct side of entry for the direction — the
 * same rule the order action enforces before a fill.
 */
export function calcRiskReward(params: {
  side: "BUY" | "SELL";
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
}): number | null {
  const { side, entryPrice, stopLoss, targetPrice } = params;
  if (!isPositive(entryPrice) || !isPositive(stopLoss) || !isPositive(targetPrice)) return null;

  const risk = side === "BUY" ? entryPrice - stopLoss : stopLoss - entryPrice;
  const reward = side === "BUY" ? targetPrice - entryPrice : entryPrice - targetPrice;
  if (risk <= 0 || reward <= 0) return null;

  return round2(reward / risk);
}

/**
 * How far a closed trade travelled in units of its own initial risk. This is
 * the figure that makes trades of different sizes comparable in the journal.
 */
export function calcRMultiple(params: {
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
}): number | null {
  const { side, entryPrice, exitPrice, stopLoss } = params;
  if (!isPositive(entryPrice) || !isPositive(exitPrice) || !isPositive(stopLoss)) return null;

  const risk = Math.abs(entryPrice - stopLoss);
  if (risk <= 0) return null;

  const move = side === "BUY" ? exitPrice - entryPrice : entryPrice - exitPrice;
  return round2(move / risk);
}

function isPositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
