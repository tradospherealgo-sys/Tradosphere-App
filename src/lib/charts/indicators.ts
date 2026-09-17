import type { Candle } from "@/lib/market-data/types";

/**
 * Technical indicators, computed purely from real OHLC candles the provider
 * already returned.
 *
 * Every series returned here is the same length as its input, with `null`
 * in the leading positions where there isn't yet enough history to compute
 * a value. That matters: padding with zeros or back-filling the first real
 * value would draw a line that looks like price action but isn't, which is
 * exactly the class of invented data this codebase refuses to render.
 */

export type Series = (number | null)[];

/** Simple moving average of the closing price. */
export function sma(values: number[], period: number): Series {
  if (period <= 0) return values.map(() => null);
  const out: Series = [];
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? round2(sum / period) : null);
  }
  return out;
}

/**
 * Exponential moving average. Seeded with the SMA of the first `period`
 * values, which is the convention charting platforms use — seeding with the
 * first close instead makes the early series diverge noticeably.
 */
export function ema(values: number[], period: number): Series {
  if (period <= 0 || values.length < period) return values.map(() => null);

  const k = 2 / (period + 1);
  const out: Series = new Array(values.length).fill(null);

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = round2(prev);

  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = round2(prev);
  }
  return out;
}

/**
 * Wilder's RSI. Uses Wilder smoothing (not a plain average of the last n
 * changes), matching what every trading platform displays.
 */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = round2(rsiFrom(avgGain, avgLoss));

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = round2(rsiFrom(avgGain, avgLoss));
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  // An unbroken run of up-closes has no downside to divide by. RSI is 100
  // by definition there, rather than an infinity that would break the axis.
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export type BollingerBands = { upper: Series; middle: Series; lower: Series };

export function bollinger(values: number[], period = 20, stdDevs = 2): BollingerBands {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i];
    if (mean === null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (values[j] - mean) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = round2(mean + stdDevs * sd);
    lower[i] = round2(mean - stdDevs * sd);
  }
  return { upper, middle, lower };
}

/**
 * Session VWAP. Resets at each new calendar day so an intraday chart shows
 * the session's own VWAP rather than one dragged across weeks of history.
 * Returns all-null when the candles carry no volume — a "VWAP" without
 * volume is just a typical-price average wearing the wrong label.
 */
export function vwap(candles: Candle[]): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.every((c) => c.volume == null)) return out;

  let day = "";
  let cumPv = 0;
  let cumVol = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const candleDay = c.ts.slice(0, 10);
    if (candleDay !== day) {
      day = candleDay;
      cumPv = 0;
      cumVol = 0;
    }
    const volume = c.volume ?? 0;
    const typical = (c.high + c.low + c.close) / 3;
    cumPv += typical * volume;
    cumVol += volume;
    out[i] = cumVol > 0 ? round2(cumPv / cumVol) : null;
  }
  return out;
}

export type IndicatorKey = "sma20" | "sma50" | "ema20" | "vwap" | "bollinger";

/** Overlay series drawn on the price pane, keyed for the chart legend. */
export function buildOverlays(
  candles: Candle[],
  enabled: IndicatorKey[]
): { key: string; label: string; color: string; values: Series }[] {
  const closes = candles.map((c) => c.close);
  const overlays: { key: string; label: string; color: string; values: Series }[] = [];

  if (enabled.includes("sma20")) {
    overlays.push({ key: "sma20", label: "SMA 20", color: "#5fb8e0", values: sma(closes, 20) });
  }
  if (enabled.includes("sma50")) {
    overlays.push({ key: "sma50", label: "SMA 50", color: "#e0b07b", values: sma(closes, 50) });
  }
  if (enabled.includes("ema20")) {
    overlays.push({ key: "ema20", label: "EMA 20", color: "#3fe6a8", values: ema(closes, 20) });
  }
  if (enabled.includes("vwap")) {
    overlays.push({ key: "vwap", label: "VWAP", color: "#eeab3f", values: vwap(candles) });
  }
  if (enabled.includes("bollinger")) {
    const bb = bollinger(closes, 20, 2);
    overlays.push({ key: "bb_upper", label: "BB upper", color: "#6f8a8f", values: bb.upper });
    overlays.push({ key: "bb_lower", label: "BB lower", color: "#6f8a8f", values: bb.lower });
  }
  return overlays;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
