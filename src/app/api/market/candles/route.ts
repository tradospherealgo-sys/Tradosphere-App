import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitedResponse, requireUser } from "@/lib/api/guard";
import { getActiveMarketDataProvider, getMarketStatus } from "@/lib/market-data";
import type { CandleInterval } from "@/lib/market-data";

/**
 * Historical OHLC for the chart. Returns `candles: []` with
 * `configured: false` when no provider is wired up — the chart renders an
 * empty state from that, and at no point does anything here manufacture a bar
 * to fill a gap in the series.
 */
export const dynamic = "force-dynamic";

const INTERVALS: CandleInterval[] = ["1m", "5m", "15m", "1h", "1d"];

/** Default lookback per interval, chosen to fill a chart without over-fetching. */
const DEFAULT_LOOKBACK_DAYS: Record<CandleInterval, number> = {
  "1m": 2,
  "5m": 7,
  "15m": 15,
  "1h": 60,
  "1d": 365,
};

/** Upper bound on the requested window, so one URL cannot ask for a decade of 1m bars. */
const MAX_LOOKBACK_DAYS: Record<CandleInterval, number> = {
  "1m": 7,
  "5m": 30,
  "15m": 60,
  "1h": 180,
  "1d": 1825,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const gate = await requireUser();
  if ("response" in gate) return gate.response;

  if (!checkRateLimit(`candles:${gate.user.id}`, 30)) {
    return rateLimitedResponse();
  }

  const params = new URL(request.url).searchParams;
  const symbol = (params.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "A symbol is required." }, { status: 400 });
  }

  const interval = (params.get("interval") ?? "1d") as CandleInterval;
  if (!INTERVALS.includes(interval)) {
    return NextResponse.json(
      { error: `Interval must be one of ${INTERVALS.join(", ")}.` },
      { status: 400 }
    );
  }

  const to = parseDate(params.get("to")) ?? new Date();
  const from =
    parseDate(params.get("from")) ??
    new Date(to.getTime() - DEFAULT_LOOKBACK_DAYS[interval] * DAY_MS);

  if (from >= to) {
    return NextResponse.json({ error: "`from` must precede `to`." }, { status: 400 });
  }

  const clampedFrom = new Date(
    Math.max(from.getTime(), to.getTime() - MAX_LOOKBACK_DAYS[interval] * DAY_MS)
  );

  const provider = await getActiveMarketDataProvider();
  const candles = await provider.getHistoricalCandles(symbol, interval, clampedFrom, to);

  return NextResponse.json({
    configured: provider.isConfigured(),
    provider: provider.name,
    status: getMarketStatus(),
    symbol,
    interval,
    from: clampedFrom.toISOString(),
    to: to.toISOString(),
    candles,
  });
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
