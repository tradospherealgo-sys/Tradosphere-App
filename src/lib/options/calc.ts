import type { OptionLeg } from "./types";

/**
 * Pure derived-metrics for an already-fetched option chain (ATM/ITM/OTM
 * classification, PCR, Max Pain). These never invent option data — they
 * only aggregate/compare numbers that came from a real provider snapshot.
 * If a snapshot has no legs, every function here degrades to null/empty
 * rather than guessing.
 */

export function findAtmStrike(legs: OptionLeg[], spot: number): number | null {
  const strikes = uniqueStrikes(legs);
  if (strikes.length === 0) return null;
  return strikes.reduce((closest, strike) =>
    Math.abs(strike - spot) < Math.abs(closest - spot) ? strike : closest
  );
}

export type Moneyness = "ITM" | "ATM" | "OTM";

export function classifyMoneyness(
  optionType: "CE" | "PE",
  strike: number,
  atmStrike: number | null
): Moneyness {
  if (atmStrike === null || strike === atmStrike) return "ATM";
  if (optionType === "CE") return strike < atmStrike ? "ITM" : "OTM";
  return strike > atmStrike ? "ITM" : "OTM";
}

/** Put/Call ratio by open interest. Null if either side has no OI data. */
export function calcPcr(legs: OptionLeg[]): number | null {
  const callOi = sumOi(legs, "CE");
  const putOi = sumOi(legs, "PE");
  if (callOi === null || putOi === null || callOi === 0) return null;
  return round4(putOi / callOi);
}

/**
 * Max Pain: the strike at which total option-writer payout (across both
 * CE and PE) is minimized, i.e. where the most option buyers would expire
 * worthless. Computed purely from the OI already present in the chain.
 */
export function calcMaxPain(legs: OptionLeg[]): number | null {
  const strikes = uniqueStrikes(legs);
  if (strikes.length === 0) return null;

  let minPain = Infinity;
  let maxPainStrike: number | null = null;

  for (const expiry of strikes) {
    let totalPayout = 0;
    for (const leg of legs) {
      if (leg.oi == null) continue;
      if (leg.optionType === "CE" && expiry > leg.strike) {
        totalPayout += (expiry - leg.strike) * leg.oi;
      } else if (leg.optionType === "PE" && expiry < leg.strike) {
        totalPayout += (leg.strike - expiry) * leg.oi;
      }
    }
    if (totalPayout < minPain) {
      minPain = totalPayout;
      maxPainStrike = expiry;
    }
  }

  return maxPainStrike;
}

function uniqueStrikes(legs: OptionLeg[]): number[] {
  return Array.from(new Set(legs.map((l) => l.strike))).sort((a, b) => a - b);
}

function sumOi(legs: OptionLeg[], type: "CE" | "PE"): number | null {
  const relevant = legs.filter((l) => l.optionType === type);
  if (relevant.length === 0) return null;
  if (relevant.every((l) => l.oi == null)) return null;
  return relevant.reduce((sum, l) => sum + (l.oi ?? 0), 0);
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

export type Greeks = { delta: number; gamma: number; theta: number; vega: number };

/**
 * Black-Scholes Greeks, computed purely from real inputs already present in
 * a fetched option-chain snapshot (spot, strike, provider-reported IV,
 * time-to-expiry) plus a configurable risk-free rate. This is a
 * deterministic mathematical transform of real numbers — not a fabricated
 * or invented value — but callers must label it as an *estimate* in the UI
 * (e.g. "Δ (est.)") and never merge it into the same field as a
 * provider-reported Greek, so users can always tell computed-here from
 * reported-by-exchange.
 *
 * Returns null if any required real input is missing or non-positive
 * (e.g. no IV published yet, or the option has already expired) — this
 * function never guesses a substitute value.
 *
 * @param spot underlying spot price at capture
 * @param strike option strike
 * @param timeToExpiryYears time to expiry in years (e.g. 7/365)
 * @param ivPct implied volatility as a percentage (e.g. 14.5 for 14.5%), as
 *   typically reported by option-chain providers
 * @param optionType "CE" (call) or "PE" (put)
 * @param riskFreeRate annualized risk-free rate as a decimal (default 0.07,
 *   a reasonable long-run proxy for the Indian G-Sec short rate — override
 *   with a real rate if the caller has one)
 */
export function calcGreeks(
  spot: number,
  strike: number,
  timeToExpiryYears: number,
  ivPct: number,
  optionType: "CE" | "PE",
  riskFreeRate: number = 0.07
): Greeks | null {
  if (!(spot > 0) || !(strike > 0) || !(timeToExpiryYears > 0) || !(ivPct > 0)) return null;

  const sigma = ivPct / 100;
  const sqrtT = Math.sqrt(timeToExpiryYears);
  const d1 =
    (Math.log(spot / strike) + (riskFreeRate + (sigma * sigma) / 2) * timeToExpiryYears) /
    (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const pdf = standardNormalPdf(d1);
  const Nd1 = standardNormalCdf(d1);
  const Nd2 = standardNormalCdf(d2);
  const NminusD1 = standardNormalCdf(-d1);
  const NminusD2 = standardNormalCdf(-d2);

  const gamma = pdf / (spot * sigma * sqrtT);
  const vega = (spot * pdf * sqrtT) / 100; // per 1 IV point (1%), not per unit

  if (optionType === "CE") {
    const delta = Nd1;
    const theta =
      (-((spot * pdf * sigma) / (2 * sqrtT)) -
        riskFreeRate * strike * Math.exp(-riskFreeRate * timeToExpiryYears) * Nd2) /
      365; // per calendar day
    return {
      delta: round4(delta),
      gamma: round4(gamma),
      theta: round4(theta),
      vega: round4(vega),
    };
  }

  const delta = -NminusD1;
  const theta =
    (-((spot * pdf * sigma) / (2 * sqrtT)) +
      riskFreeRate * strike * Math.exp(-riskFreeRate * timeToExpiryYears) * NminusD2) /
    365;
  return {
    delta: round4(delta),
    gamma: round4(gamma),
    theta: round4(theta),
    vega: round4(vega),
  };
}

function standardNormalPdf(x: number): number {
  return Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);
}

/** Abramowitz & Stegun 7.1.26 approximation of the standard normal CDF (max error ~1.5e-7). */
function standardNormalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/** Whole days between an ISO expiry date (YYYY-MM-DD) and now, floored to >=0. */
export function daysToExpiry(expiryIso: string, now: Date = new Date()): number {
  const expiry = new Date(`${expiryIso}T15:30:00+05:30`); // NSE market close IST
  const diffMs = expiry.getTime() - now.getTime();
  return Math.max(0, diffMs / (1000 * 60 * 60 * 24));
}
