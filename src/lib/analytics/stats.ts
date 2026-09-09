import type { Trade } from "@/types/database";

/**
 * Trading statistics computed from closed paper trades.
 *
 * Every figure here is derived from rows the engine actually wrote — there
 * is no synthetic history and no benchmark series. With no trades the whole
 * result is nulls rather than zeros, because "no data" and "zero win rate"
 * are different statements and the UI needs to be able to tell them apart.
 */

export type TradeStats = {
  totalTrades: number;
  wins: number;
  losses: number;
  breakEven: number;
  winRate: number | null;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  avgWin: number | null;
  avgLoss: number | null;
  /** Average P&L per trade, i.e. the expectancy in currency terms. */
  expectancy: number | null;
  /** Gross profit ÷ gross loss. Null when there are no losses to divide by. */
  profitFactor: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
  avgRMultiple: number | null;
};

export type EquityPoint = { at: string; equity: number; pnl: number };

export type DrawdownResult = {
  maxDrawdown: number;
  maxDrawdownPct: number | null;
  peakEquity: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function calcTradeStats(trades: Trade[]): TradeStats {
  const empty: TradeStats = {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    breakEven: 0,
    winRate: null,
    grossProfit: 0,
    grossLoss: 0,
    netPnl: 0,
    avgWin: null,
    avgLoss: null,
    expectancy: null,
    profitFactor: null,
    bestTrade: null,
    worstTrade: null,
    avgRMultiple: null,
  };
  if (trades.length === 0) return empty;

  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let breakEven = 0;
  let best = -Infinity;
  let worst = Infinity;

  for (const t of trades) {
    // After costs, not before. A trade that grossed +40 and cost 60 in
    // charges left the account smaller, and a win rate that calls it a win
    // is the single easiest way for this page to flatter a losing strategy.
    const pnl = t.net_realized_pnl;
    if (pnl > 0) {
      wins++;
      grossProfit += pnl;
    } else if (pnl < 0) {
      losses++;
      grossLoss += Math.abs(pnl);
    } else {
      breakEven++;
    }
    if (pnl > best) best = pnl;
    if (pnl < worst) worst = pnl;
  }

  // A trade closed exactly flat is neither a win nor a loss, so it is
  // excluded from the win-rate denominator rather than counted as a loss.
  const decided = wins + losses;
  const rMultiples = trades
    .map((t) => t.r_multiple)
    .filter((r): r is number => r !== null && Number.isFinite(r));

  return {
    totalTrades: trades.length,
    wins,
    losses,
    breakEven,
    winRate: decided > 0 ? round2((wins / decided) * 100) : null,
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    netPnl: round2(grossProfit - grossLoss),
    avgWin: wins > 0 ? round2(grossProfit / wins) : null,
    avgLoss: losses > 0 ? round2(grossLoss / losses) : null,
    expectancy: round2((grossProfit - grossLoss) / trades.length),
    // Undefined rather than Infinity when nothing has lost yet: a profit
    // factor of ∞ off three winning trades is not a meaningful number.
    profitFactor: grossLoss > 0 ? round2(grossProfit / grossLoss) : null,
    bestTrade: round2(best),
    worstTrade: round2(worst),
    avgRMultiple:
      rMultiples.length > 0
        ? round2(rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length)
        : null,
  };
}

/**
 * Realized equity curve: starting capital plus cumulative after-costs P&L,
 * one point per closed trade. It deliberately excludes open-position marks,
 * so the curve only ever moves on a real, booked result — and it tracks
 * charges, so it stays consistent with the account's cash balance.
 */
export function buildEquityCurve(trades: Trade[], startingCapital: number): EquityPoint[] {
  const ordered = [...trades].sort(
    (a, b) => new Date(a.closed_at).getTime() - new Date(b.closed_at).getTime()
  );
  let equity = startingCapital;
  const points: EquityPoint[] = [{ at: ordered[0]?.opened_at ?? new Date().toISOString(), equity, pnl: 0 }];
  for (const t of ordered) {
    equity = round2(equity + t.net_realized_pnl);
    points.push({ at: t.closed_at, equity, pnl: round2(t.net_realized_pnl) });
  }
  return points;
}

export function calcDrawdown(curve: EquityPoint[]): DrawdownResult {
  let peak = curve[0]?.equity ?? 0;
  let maxDd = 0;
  let peakAtMaxDd = peak;

  for (const p of curve) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak - p.equity;
    if (dd > maxDd) {
      maxDd = dd;
      peakAtMaxDd = peak;
    }
  }

  return {
    maxDrawdown: round2(maxDd),
    maxDrawdownPct: peakAtMaxDd > 0 ? round2((maxDd / peakAtMaxDd) * 100) : null,
    peakEquity: round2(peak),
  };
}
