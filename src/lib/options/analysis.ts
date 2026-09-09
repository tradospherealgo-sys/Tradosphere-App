import { calcMaxPain, calcPcr, findAtmStrike } from "./calc";
import type { OptionChainSnapshot, OptionLeg } from "./types";

/**
 * Chain-level analytics derived from a real provider snapshot: nothing here
 * reads a network or a database, and every field degrades to null when the
 * underlying data is absent rather than being estimated.
 *
 * The OI-implied levels deserve a caveat that belongs next to the code rather
 * than only in the UI: the strike with the largest call OI is where writers
 * have the most at stake, which is *conventionally* read as resistance. It is
 * a widely used heuristic, not a prediction, and the field names say "oi" so
 * a reader is never misled into treating it as a measured level.
 */

export type StrikeConcentration = {
  strike: number;
  oi: number;
  changeOi: number | null;
};

export type ChainAnalysis = {
  atmStrike: number | null;
  /** Put/call ratio by open interest. */
  pcr: number | null;
  /** Put/call ratio by traded volume — faster-moving than the OI ratio. */
  volumePcr: number | null;
  maxPain: number | null;
  totalCallOi: number | null;
  totalPutOi: number | null;
  totalCallVolume: number | null;
  totalPutVolume: number | null;
  /** Net OI added today, puts minus calls. Positive leans bullish by convention. */
  netChangeOi: number | null;
  /** Strike carrying the most call OI — conventionally read as resistance. */
  maxCallOiStrike: StrikeConcentration | null;
  /** Strike carrying the most put OI — conventionally read as support. */
  maxPutOiStrike: StrikeConcentration | null;
  /** Strikes with the largest OI build-up today, most significant first. */
  topOiBuildup: Array<StrikeConcentration & { optionType: "CE" | "PE" }>;
  /** Largest single-leg OI in the chain, for scaling OI bars in the UI. */
  maxLegOi: number | null;
  strikeCount: number;
};

export function analyseChain(snapshot: OptionChainSnapshot): ChainAnalysis {
  const legs = snapshot.legs;
  const calls = legs.filter((l) => l.optionType === "CE");
  const puts = legs.filter((l) => l.optionType === "PE");

  const totalCallVolume = sumOrNull(calls, (l) => l.volume);
  const totalPutVolume = sumOrNull(puts, (l) => l.volume);

  const callChange = sumOrNull(calls, (l) => l.changeOi);
  const putChange = sumOrNull(puts, (l) => l.changeOi);

  return {
    atmStrike:
      snapshot.spotAtCapture !== null ? findAtmStrike(legs, snapshot.spotAtCapture) : null,
    pcr: calcPcr(legs),
    volumePcr:
      totalCallVolume !== null && totalPutVolume !== null && totalCallVolume > 0
        ? round4(totalPutVolume / totalCallVolume)
        : null,
    maxPain: calcMaxPain(legs),
    totalCallOi: sumOrNull(calls, (l) => l.oi),
    totalPutOi: sumOrNull(puts, (l) => l.oi),
    totalCallVolume,
    totalPutVolume,
    netChangeOi:
      callChange !== null && putChange !== null ? putChange - callChange : null,
    maxCallOiStrike: peakOi(calls),
    maxPutOiStrike: peakOi(puts),
    topOiBuildup: topBuildup(legs),
    maxLegOi: legs.reduce<number | null>(
      (max, l) => (l.oi == null ? max : Math.max(max ?? 0, l.oi)),
      null
    ),
    strikeCount: new Set(legs.map((l) => l.strike)).size,
  };
}

/**
 * Sums a nullable field, returning null when the provider published nothing
 * for it. Treating "no data" as zero would silently turn an unavailable feed
 * into a confident-looking 0 OI.
 */
function sumOrNull(legs: OptionLeg[], pick: (leg: OptionLeg) => number | null): number | null {
  const values = legs.map(pick).filter((v): v is number => v != null);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
}

function peakOi(legs: OptionLeg[]): StrikeConcentration | null {
  let best: StrikeConcentration | null = null;
  for (const leg of legs) {
    if (leg.oi == null) continue;
    if (!best || leg.oi > best.oi) {
      best = { strike: leg.strike, oi: leg.oi, changeOi: leg.changeOi };
    }
  }
  return best;
}

function topBuildup(
  legs: OptionLeg[]
): Array<StrikeConcentration & { optionType: "CE" | "PE" }> {
  return legs
    .filter((l): l is OptionLeg & { changeOi: number } => l.changeOi != null)
    .sort((a, b) => Math.abs(b.changeOi) - Math.abs(a.changeOi))
    .slice(0, 5)
    .map((l) => ({
      strike: l.strike,
      oi: l.oi ?? 0,
      changeOi: l.changeOi,
      optionType: l.optionType,
    }));
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
