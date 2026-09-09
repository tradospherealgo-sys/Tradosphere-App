import type { OrderProduct, OrderSide } from "@/types/database";

/**
 * Indian equity statutory charges — DISPLAY-ONLY PREVIEW.
 *
 * The authoritative computation lives in `calc_trade_charges` in migration
 * 0016 and runs inside the fill, in the database. This module exists so the
 * order pad can show a cost estimate before the user commits, and it mirrors
 * the SQL rate-for-rate. It must never be used to *tell* the ledger what to
 * charge: a client holding the anon key can call the RPC directly, so any
 * charge it supplied would be a number it chose for itself.
 *
 * If the two ever disagree, the SQL is correct and this file is the bug.
 *
 * Rates (NSE cash segment):
 *   Brokerage      CNC nil; MIS 0.03% of turnover capped at ₹20.
 *   STT            CNC 0.1% both sides; MIS 0.025% on the SELL only.
 *   Exchange txn   0.00297%.
 *   SEBI turnover  0.0001% (₹10 per crore).
 *   IPFT           0.0001%, reported folded into the exchange line.
 *   Stamp duty     BUY only. CNC 0.015%, MIS 0.003%.
 *   GST            18% on brokerage + exchange + SEBI + IPFT.
 */

export type Charges = {
  brokerage: number;
  stt: number;
  exchangeCharges: number;
  sebiCharges: number;
  stampDuty: number;
  gst: number;
  total: number;
};

const BROKERAGE_RATE_MIS = 0.0003;
const BROKERAGE_CAP = 20;
const STT_RATE_CNC = 0.001;
const STT_RATE_MIS_SELL = 0.00025;
const EXCHANGE_RATE = 0.0000297;
const SEBI_RATE = 0.000001;
const IPFT_RATE = 0.000001;
const STAMP_RATE_CNC = 0.00015;
const STAMP_RATE_MIS = 0.00003;
const GST_RATE = 0.18;

export function calcCharges(
  side: OrderSide,
  product: OrderProduct,
  turnover: number
): Charges {
  const value = Number.isFinite(turnover) ? Math.max(turnover, 0) : 0;

  const brokerage =
    product === "CNC" ? 0 : Math.min(round2(value * BROKERAGE_RATE_MIS), BROKERAGE_CAP);

  const stt =
    product === "CNC"
      ? round2(value * STT_RATE_CNC)
      : side === "SELL"
        ? round2(value * STT_RATE_MIS_SELL)
        : 0;

  const exchange = round2(value * EXCHANGE_RATE);
  const sebi = round2(value * SEBI_RATE);
  const ipft = round2(value * IPFT_RATE);

  const stampDuty =
    side !== "BUY"
      ? 0
      : round2(value * (product === "CNC" ? STAMP_RATE_CNC : STAMP_RATE_MIS));

  const gst = round2((brokerage + exchange + sebi + ipft) * GST_RATE);

  return {
    brokerage,
    stt,
    exchangeCharges: exchange + ipft,
    sebiCharges: sebi,
    stampDuty,
    gst,
    total: round2(brokerage + stt + exchange + ipft + sebi + stampDuty + gst),
  };
}

/**
 * Mirrors `should_fill`. Used by the order-matching pass to decide which
 * resting orders to submit to the database, and by the UI to explain why an
 * order is still resting. The database re-evaluates it before every fill, so
 * a wrong answer here can only cost a wasted round trip, never a bad fill.
 */
export function shouldFill(
  variety: "MARKET" | "LIMIT" | "SL" | "SL_M",
  side: OrderSide,
  ltp: number | null,
  limitPrice: number | null,
  triggerPrice: number | null
): boolean {
  if (ltp === null || !Number.isFinite(ltp) || ltp <= 0) return false;

  switch (variety) {
    case "MARKET":
      return true;
    case "LIMIT":
      if (limitPrice === null) return false;
      return side === "BUY" ? ltp <= limitPrice : ltp >= limitPrice;
    case "SL_M":
      if (triggerPrice === null) return false;
      return side === "BUY" ? ltp >= triggerPrice : ltp <= triggerPrice;
    case "SL":
      if (limitPrice === null || triggerPrice === null) return false;
      return side === "BUY"
        ? ltp >= triggerPrice && ltp <= limitPrice
        : ltp <= triggerPrice && ltp >= limitPrice;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
