"use client";

import { useState } from "react";
import { CandlestickChart } from "@/components/candlestick-chart";
import type { IndicatorKey } from "@/lib/charts/indicators";
import type { Candle } from "@/lib/market-data/types";

const OVERLAY_OPTIONS: { key: IndicatorKey; label: string }[] = [
  { key: "sma20", label: "SMA 20" },
  { key: "sma50", label: "SMA 50" },
  { key: "ema20", label: "EMA 20" },
  { key: "vwap", label: "VWAP" },
  { key: "bollinger", label: "Bollinger" },
];

export function ChartPanel({ candles }: { candles: Candle[] }) {
  const [active, setActive] = useState<IndicatorKey[]>(["sma20"]);
  const [showRsi, setShowRsi] = useState(false);

  const toggle = (key: IndicatorKey) =>
    setActive((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  return (
    <div className="rounded-2xl border border-border bg-surface p-3 md:p-5">
      <div className="mb-3 flex flex-wrap gap-2">
        {OVERLAY_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => toggle(o.key)}
            aria-pressed={active.includes(o.key)}
            className={`h-9 rounded-full border px-3 text-xs ${
              active.includes(o.key)
                ? "border-accent bg-accent/10 text-text"
                : "border-border text-text-muted"
            }`}
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowRsi((v) => !v)}
          aria-pressed={showRsi}
          className={`h-9 rounded-full border px-3 text-xs ${
            showRsi ? "border-accent bg-accent/10 text-text" : "border-border text-text-muted"
          }`}
        >
          RSI
        </button>
      </div>

      <CandlestickChart candles={candles} indicators={active} showRsi={showRsi} />
    </div>
  );
}
