import { getActiveMarketDataProvider } from "@/lib/market-data";
import { EmptyState } from "@/components/empty-state";
import type { CandleInterval } from "@/lib/market-data/types";
import { ChartPanel } from "./chart-panel";

const INTERVALS: CandleInterval[] = ["1d", "1h", "15m", "5m", "1m"];

export const dynamic = "force-dynamic";

export default async function ChartsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; interval?: string }>;
}) {
  const params = await searchParams;
  const symbol = (params.symbol ?? "RELIANCE").toUpperCase();
  const interval = (INTERVALS.includes(params.interval as CandleInterval)
    ? params.interval
    : "1d") as CandleInterval;

  const provider = await getActiveMarketDataProvider();
  // Intraday intervals need a much shorter lookback — 90 days of 1-minute
  // candles is ~35k bars, which most broker APIs refuse outright.
  const lookbackDays: Record<CandleInterval, number> = {
    "1m": 5,
    "5m": 15,
    "15m": 40,
    "1h": 120,
    "1d": 400,
  };
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays[interval] * 24 * 60 * 60 * 1000);
  const candles = provider.isConfigured()
    ? await provider.getHistoricalCandles(symbol, interval, from, to)
    : [];

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">Interactive Charts</h1>
        <p className="text-sm text-text-muted">
          Real historical OHLC candles from the active market-data provider.
        </p>
      </header>

      <form className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4" method="get">
        <div>
          <label className="block text-xs text-text-faint">Symbol</label>
          <input
            name="symbol"
            defaultValue={symbol}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3 text-base text-text"
          />
        </div>
        <div>
          <label className="block text-xs text-text-faint">Interval</label>
          <select
            name="interval"
            defaultValue={interval}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3 text-base text-text"
          >
            {INTERVALS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-11 rounded-lg border border-border px-4 text-sm text-text-muted hover:border-accent hover:text-text"
        >
          Load
        </button>
      </form>

      {!provider.isConfigured() ? (
        <EmptyState
          title="No market-data provider configured"
          body="An admin needs to enable one in Admin → Integrations before charts can render."
        />
      ) : candles.length === 0 ? (
        <EmptyState
          title="No candle data available"
          body={`Either "${symbol}" wasn't found, or intraday history isn't supported by the current provider (try interval = 1d).`}
        />
      ) : (
        <ChartPanel candles={candles} />
      )}
    </div>
  );
}
