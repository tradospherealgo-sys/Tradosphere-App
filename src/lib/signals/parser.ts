import type { InstrumentKind, OrderSide } from "@/types/database";

/**
 * Telegram message → normalised signal.
 *
 * The parser is deliberately conservative. It only ever *extracts* numbers
 * that are explicitly written in the message; it never derives a missing
 * level, never assumes a default stop distance, and never guesses a symbol
 * from context. A message it cannot read with confidence is returned as
 * `unparseable` so it lands in the admin inbox as a visible parse failure
 * rather than becoming a signal with invented levels.
 *
 * Desk formats vary between channels, so this recognises the common Indian
 * broadcast shapes rather than one rigid grammar:
 *
 *   BUY RELIANCE ABOVE 2450 SL 2400 TGT 2500 2550
 *   SELL NIFTY 24500 PE @ 120-125 | SL 95 | T1 150 T2 180
 *   LONG HDFCBANK CMP 1650, Stoploss 1620, Target 1710
 */

export type ParsedSignal = {
  symbol: string;
  direction: OrderSide;
  instrumentKind: InstrumentKind;
  entryPrice: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
};

export type ParseResult =
  | { ok: true; signal: ParsedSignal }
  | { ok: false; reason: string };

const LONG_WORDS = ["BUY", "LONG", "BUYING"];
const SHORT_WORDS = ["SELL", "SHORT", "SELLING"];

// Words that can follow a direction but are not the symbol.
const NOISE = new Set([
  "CALL",
  "CALLS",
  "PUT",
  "PUTS",
  "ABOVE",
  "BELOW",
  "NEAR",
  "AROUND",
  "CMP",
  "AT",
  "ENTRY",
  "THE",
  "IN",
  "ON",
]);

const NUMBER = "\\d+(?:\\.\\d+)?";

// `\b` only works after a word character, so a punctuation label like "@"
// gets no boundary assertion.
function boundary(label: string): string {
  return /[A-Za-z0-9]$/.test(label) || label.endsWith("*") ? "\\b" : "";
}

function firstNumberAfter(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const re = new RegExp(`${label}${boundary(label)}[^0-9\\-]{0,12}(${NUMBER})`, "i");
    const m = re.exec(text);
    if (m) return Number(m[1]);
  }
  return null;
}

function numbersAfter(text: string, labels: string[], max: number): number[] {
  for (const label of labels) {
    const re = new RegExp(`${label}${boundary(label)}([^A-Za-z\\n]{0,80})`, "i");
    const m = re.exec(text);
    if (!m) continue;
    const found = m[1].match(new RegExp(NUMBER, "g"));
    if (found && found.length > 0) return found.slice(0, max).map(Number);
  }
  return [];
}

function parseEntry(text: string): Pick<ParsedSignal, "entryPrice" | "entryLow" | "entryHigh"> {
  const rangeRe = new RegExp(
    `(?:(?:ABOVE|BELOW|ENTRY|CMP|BUY|SELL|AROUND|NEAR)\\b|@)[^0-9\\n]{0,12}(${NUMBER})\\s*(?:-|–|—|to|TO)\\s*(${NUMBER})`,
    "i"
  );
  const range = rangeRe.exec(text);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    // A "range" whose bounds are inverted is a formatting accident, not a
    // range; treat it as unreadable rather than silently swapping the ends.
    if (low <= high) return { entryPrice: null, entryLow: low, entryHigh: high };
  }

  const single = firstNumberAfter(text, ["ABOVE", "BELOW", "ENTRY", "CMP", "AROUND", "NEAR", "@"]);
  if (single !== null) return { entryPrice: single, entryLow: null, entryHigh: null };
  return { entryPrice: null, entryLow: null, entryHigh: null };
}

function parseTargets(text: string): [number | null, number | null, number | null] {
  const explicit: (number | null)[] = [
    firstNumberAfter(text, ["T1", "TARGET\\s*1", "TGT\\s*1"]),
    firstNumberAfter(text, ["T2", "TARGET\\s*2", "TGT\\s*2"]),
    firstNumberAfter(text, ["T3", "TARGET\\s*3", "TGT\\s*3"]),
  ];
  if (explicit.some((t) => t !== null)) {
    return [explicit[0], explicit[1], explicit[2]];
  }

  const listed = numbersAfter(text, ["TARGETS?", "TGTS?"], 3);
  return [listed[0] ?? null, listed[1] ?? null, listed[2] ?? null];
}

function detectInstrument(text: string): InstrumentKind {
  const upper = text.toUpperCase();
  const isOption = /\b\d+\s*(CE|PE)\b|\b(CALL|PUT)\b/.test(upper);
  if (!isOption) return "EQUITY";
  const isIndex = /\b(NIFTY|BANKNIFTY|BANK\s*NIFTY|FINNIFTY|MIDCPNIFTY|SENSEX)\b/.test(upper);
  return isIndex ? "INDEX_OPTION" : "STOCK_OPTION";
}

function extractSymbol(tokens: string[], directionIndex: number): string | null {
  for (let i = directionIndex + 1; i < tokens.length; i++) {
    const raw = tokens[i].replace(/[^A-Z0-9&-]/g, "");
    if (!raw) continue;
    if (NOISE.has(raw)) continue;
    // A bare number is a price, not a symbol.
    if (/^\d/.test(raw)) return null;
    return raw;
  }
  return null;
}

export function parseSignalMessage(message: string): ParseResult {
  const text = message.trim();
  if (!text) return { ok: false, reason: "Empty message." };

  const upper = text.toUpperCase();
  const tokens = upper.split(/\s+/);

  let direction: OrderSide | null = null;
  let directionIndex = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/[^A-Z]/g, "");
    if (LONG_WORDS.includes(t)) {
      direction = "BUY";
      directionIndex = i;
      break;
    }
    if (SHORT_WORDS.includes(t)) {
      direction = "SELL";
      directionIndex = i;
      break;
    }
  }
  if (!direction) {
    return { ok: false, reason: "No BUY/SELL direction found." };
  }

  const symbol = extractSymbol(tokens, directionIndex);
  if (!symbol || symbol.length < 2) {
    return { ok: false, reason: "No symbol found after the direction keyword." };
  }

  const instrumentKind = detectInstrument(upper);
  const entry = parseEntry(upper);
  const stopLoss = firstNumberAfter(upper, ["SL", "STOP\\s*LOSS", "STOPLOSS"]);
  const [target1, target2, target3] = parseTargets(upper);

  // A call with neither an entry nor a stop is not actionable and, more
  // importantly, is a strong sign the message was chat rather than a signal.
  if (entry.entryPrice === null && entry.entryLow === null && stopLoss === null) {
    return { ok: false, reason: "No entry or stop-loss level found." };
  }

  return {
    ok: true,
    signal: {
      symbol,
      direction,
      instrumentKind,
      ...entry,
      stopLoss,
      target1,
      target2,
      target3,
    },
  };
}
