"use client";

import { useEffect, useState } from "react";
import { PriceChart } from "@/components/price-chart";
import { EmptyState } from "@/components/empty-state";
import type { IndicatorKey } from "@/lib/charts/indicators";
import type { CandleInterval, Candle } from "@/lib/market-data/types";
import type { MarketStatus } from "@/lib/market-data/market-hours";

/**
 * Chart workspace. Candles are fetched from /api/market/candles so switching
 * interval or symbol does not round-trip a full server render, and so the
 * three outcomes that matter stay distinguishable: no provider configured,
 * provider configured but this symbol has no data, and the request failed.
 * Collapsing those into one "no chart" state is how a broken feed gets
 * mistaken for an illiquid stock.
 */

const OVERLAY_OPTIONS: { key: IndicatorKey; label: string }[] = [
  { key: "sma20", label: "SMA 20" },
  { key: "sma50", label: "SMA 50" },
  { key: "ema20", label: "EMA 20" },
  { key: "vwap", label: "VWAP" },
  { key: "bollinger", label: "Bollinger" },
];

const INTERVALS: CandleInterval[] = ["1m", "5m", "15m", "1h", "1d"];
const INTRADAY: CandleInterval[] = ["1m", "5m", "15m", "1h"];

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; candles: Candle[]; configured: boolean; status: MarketStatus };

type Resolved = Exclude<Load, { state: "loading" }>;
/** A settled result, tagged with the request it answers. */
type Settled = Resolved & { key: string };

async function fetchCandles(
  symbol: string,
  interval: CandleInterval,
  signal: AbortSignal
): Promise<Resolved> {
  const response = await fetch(
    `/api/market/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}`,
    { signal }
  );
  const body = await response.json();

  if (!response.ok) {
    return { state: "error", message: body?.error ?? "Failed to load candles." };
  }

  return {
    state: "ready",
    candles: body.candles ?? [],
    configured: Boolean(body.configured),
    status: body.status,
  };
}

export function ChartPanel({ initialSymbol }: { initialSymbol: string }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [draftSymbol, setDraftSymbol] = useState(initialSymbol);
  const [interval, setInterval] = useState<CandleInterval>("1d");
  const [active, setActive] = useState<IndicatorKey[]>(["sma20"]);
  const [showRsi, setShowRsi] = useState(false);
  const [settled, setSettled] = useState<Settled | null>(null);

  // Loading is derived, not stored: a result is only current if it answers
  // the request the UI is asking for right now. That makes an in-flight
  // symbol switch show a spinner rather than the previous symbol's candles.
  const requestKey = `${symbol}:${interval}`;
  const load: Load = settled?.key === requestKey ? settled : { state: "loading" };

  const toggle = (key: IndicatorKey) =>
    setActive((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  useEffect(() => {
    const controller = new AbortController();

    fetchCandles(symbol, interval, controller.signal)
      .then((result) => setSettled({ key: requestKey, ...result }))
      .catch((error: Error) => {
        // An abort is the expected outcome of switching symbol mid-flight,
        // not a failure to report.
        if (error.name === "AbortError") return;
        setSettled({
          key: requestKey,
          state: "error",
          message: "Could not reach the market-data service.",
        });
      });

    return () => controller.abort();
  }, [symbol, interval, requestKey]);

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setSymbol(draftSymbol.trim().toUpperCase());
        }}
      >
        <div>
          <label className="block text-xs text-text-faint" htmlFor="chart-symbol">
            Symbol
          </label>
          <input
            id="chart-symbol"
            value={draftSymbol}
            onChange={(event) => setDraftSymbol(event.target.value)}
            className="mt-1 h-11 w-40 rounded-lg border border-border bg-surface px-3 text-base text-text"
          />
        </div>
        <button
          type="submit"
          className="h-11 rounded-lg border border-border px-4 text-sm text-text-muted hover:border-accent hover:text-text"
        >
          Load
        </button>

        <div className="flex gap-1 rounded-lg border border-border p-1">
          {INTERVALS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setInterval(option)}
              aria-pressed={interval === option}
              className={`h-9 rounded-md px-3 text-xs ${
                interval === option ? "bg-accent/15 text-text" : "text-text-muted"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </form>

      <div className="flex flex-wrap gap-2">
        {OVERLAY_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => toggle(option.key)}
            aria-pressed={active.includes(option.key)}
            className={`h-9 rounded-full border px-3 text-xs ${
              active.includes(option.key)
                ? "border-accent bg-accent/10 text-text"
                : "border-border text-text-muted"
            }`}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowRsi((value) => !value)}
          aria-pressed={showRsi}
          className={`h-9 rounded-full border px-3 text-xs ${
            showRsi ? "border-accent bg-accent/10 text-text" : "border-border text-text-muted"
          }`}
        >
          RSI
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-3 md:p-5">
        {load.state === "loading" ? (
          <div
            role="status"
            className="flex h-[420px] items-center justify-center text-sm text-text-muted"
          >
            Loading {symbol} {interval} candles…
          </div>
        ) : load.state === "error" ? (
          <EmptyState title="Chart unavailable" body={load.message} />
        ) : !load.configured ? (
          <EmptyState
            title="No market-data provider configured"
            body="An admin needs to enable one in Admin → Integrations before charts can render."
          />
        ) : load.candles.length === 0 ? (
          <EmptyState
            title="No candle data available"
            body={`Either "${symbol}" wasn't found, or the active provider does not serve ${interval} history. Try interval 1d.`}
          />
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
              <span>
                {symbol} · {interval} · {load.candles.length} bars
              </span>
              <span>{load.status.label}</span>
            </div>
            <PriceChart
              candles={load.candles}
              indicators={active}
              showRsi={showRsi}
              intraday={INTRADAY.includes(interval)}
            />
          </>
        )}
      </div>
    </div>
  );
}
