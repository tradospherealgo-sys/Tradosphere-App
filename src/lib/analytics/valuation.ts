import type { Position } from "@/types/database";
import type { Quote } from "@/lib/market-data/types";
import { calcUnrealizedPnl } from "@/lib/trading/pnl";

/**
 * Mark-to-market valuation of open positions.
 *
 * A position with no live quote is *not* valued at cost — that would report
 * an unrealized P&L of zero, which reads as "flat" rather than "unknown".
 * It is instead counted in `unquoted`, and every total that depends on a
 * live price is returned as null when coverage is incomplete, so the UI can
 * say "cannot be valued right now" instead of showing a wrong number.
 */

export type PositionValuation = {
  position: Position;
  lastPrice: number | null;
  prevClose: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  /** Move since the previous close, i.e. today's contribution. */
  dayPnl: number | null;
};

export type PortfolioValuation = {
  rows: PositionValuation[];
  investedAtCost: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  dayPnl: number | null;
  /** Positions with no live quote available. */
  unquoted: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function valuePositions(
  positions: Position[],
  quotes: Quote[]
): PortfolioValuation {
  const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  const rows = positions.map<PositionValuation>((position) => {
    const quote = bySymbol.get(position.symbol.toUpperCase()) ?? null;
    if (!quote) {
      return {
        position,
        lastPrice: null,
        prevClose: null,
        marketValue: null,
        unrealizedPnl: null,
        dayPnl: null,
      };
    }
    const direction = position.side === "BUY" ? 1 : -1;
    return {
      position,
      lastPrice: quote.lastPrice,
      prevClose: quote.prevClose,
      marketValue: round2(quote.lastPrice * position.quantity),
      unrealizedPnl: calcUnrealizedPnl({
        side: position.side,
        quantity: position.quantity,
        avgPrice: position.avg_price,
        lastPrice: quote.lastPrice,
      }),
      dayPnl:
        quote.prevClose !== null
          ? round2((quote.lastPrice - quote.prevClose) * position.quantity * direction)
          : null,
    };
  });

  const investedAtCost = round2(
    positions.reduce((sum, p) => sum + p.avg_price * p.quantity, 0)
  );
  const unquoted = rows.filter((r) => r.lastPrice === null).length;

  const sumOrNull = (pick: (r: PositionValuation) => number | null): number | null => {
    let total = 0;
    for (const r of rows) {
      const v = pick(r);
      if (v === null) return null;
      total += v;
    }
    return round2(total);
  };

  return {
    rows,
    investedAtCost,
    marketValue: sumOrNull((r) => r.marketValue),
    unrealizedPnl: sumOrNull((r) => r.unrealizedPnl),
    dayPnl: sumOrNull((r) => r.dayPnl),
    unquoted,
  };
}

export type AllocationSlice = { symbol: string; value: number; pct: number };

/** Allocation by symbol at market value. Empty when any leg is unquoted. */
export function calcAllocation(valuation: PortfolioValuation): AllocationSlice[] {
  if (valuation.marketValue === null || valuation.marketValue <= 0) return [];
  const bySymbol = new Map<string, number>();
  for (const row of valuation.rows) {
    if (row.marketValue === null) continue;
    bySymbol.set(
      row.position.symbol,
      (bySymbol.get(row.position.symbol) ?? 0) + row.marketValue
    );
  }
  const total = valuation.marketValue;
  return Array.from(bySymbol, ([symbol, value]) => ({
    symbol,
    value: round2(value),
    pct: round2((value / total) * 100),
  })).sort((a, b) => b.value - a.value);
}
