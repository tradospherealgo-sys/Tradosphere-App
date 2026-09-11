import type { SignalCategory } from "@/types/database";

/**
 * Same-day duplicate detection. Mirrors the formula computed in the n8n
 * Signal OS pipeline's "Parse AI Output" node exactly, so a call relayed
 * through both the AI pipeline and this rule-based Telegram path (or resent
 * verbatim by a desk) collides on the same `signals.fingerprint` value
 * rather than producing a second row.
 */
export function computeSignalFingerprint(input: {
  category: SignalCategory;
  symbol: string;
  action: string | null;
  entry: number | null;
  stopLoss: number | null;
  targets: (number | null)[];
}): string {
  const today = new Date().toISOString().slice(0, 10);
  const targetsPart = input.targets.filter((t): t is number => t !== null).join(",");
  const parts = [input.category, input.symbol, input.action, input.entry, input.stopLoss, targetsPart];
  const source = parts
    .map((v) => (v === null || v === undefined ? "" : String(v)))
    .join("|")
    .toUpperCase();
  return `${today}|${source}`;
}
