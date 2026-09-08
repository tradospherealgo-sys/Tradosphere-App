"use client";

import { useState } from "react";
import { calcPositionSize, calcRiskReward } from "@/lib/trading/risk";

/**
 * Sizing calculator. Runs entirely in the browser off numbers the user
 * types plus their own account equity — it places no order and writes
 * nothing, so there is no server round trip and nothing to authorise.
 */
export function PositionSizer({
  equity,
  defaultRiskPct,
  currency,
}: {
  equity: number | null;
  defaultRiskPct: number;
  currency: string;
}) {
  const [riskPct, setRiskPct] = useState(String(defaultRiskPct));
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [lotSize, setLotSize] = useState("1");

  const num = (s: string) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };

  const sizing =
    equity === null
      ? null
      : calcPositionSize({
          equity,
          riskPct: num(riskPct),
          entryPrice: num(entry),
          stopLoss: num(stop),
          lotSize: num(lotSize),
        });

  // Direction is implied by where the stop sits relative to entry: a stop
  // below the entry is a long, above it a short. Asking for it separately
  // would let the user describe a trade that contradicts its own levels.
  const rr = target
    ? calcRiskReward({
        side: num(stop) < num(entry) ? "BUY" : "SELL",
        entryPrice: num(entry),
        stopLoss: num(stop),
        targetPrice: num(target),
      })
    : null;

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);

  const field =
    "min-h-11 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm text-text outline-none focus:border-accent";

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium text-text">Position sizing</h2>
      <p className="mt-1 text-xs text-text-muted">
        {equity === null
          ? "Your account balance is unavailable, so quantity cannot be sized."
          : `Sized against ${fmt(equity)} of account equity.`}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-faint">Risk %</span>
          <input
            inputMode="decimal"
            value={riskPct}
            onChange={(e) => setRiskPct(e.target.value)}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-faint">Entry</span>
          <input
            inputMode="decimal"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-faint">Stop loss</span>
          <input
            inputMode="decimal"
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-faint">Target</span>
          <input
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-faint">Lot size</span>
          <input
            inputMode="numeric"
            value={lotSize}
            onChange={(e) => setLotSize(e.target.value)}
            className={field}
          />
        </label>
      </div>

      {sizing === null ? (
        <p className="mt-4 text-xs text-text-faint">
          Enter an entry price and a stop loss to size the trade.
        </p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Out label="Quantity" value={String(sizing.quantity)} />
          <Out label="Lots" value={String(sizing.lots)} />
          <Out label="Risk at stop" value={fmt(sizing.actualRisk)} />
          <Out label="Notional" value={fmt(sizing.notional)} />
        </dl>
      )}

      {sizing !== null && sizing.quantity === 0 ? (
        <p className="mt-3 text-xs text-warn">
          One lot risks more than {fmt(sizing.riskAmount)}. Widen the risk
          budget or move the stop closer.
        </p>
      ) : null}

      {rr !== null ? (
        <p className="mt-3 text-xs text-text-muted">
          Reward:risk on this level set is{" "}
          <span className="text-text">{rr.toFixed(2)}R</span>.
        </p>
      ) : null}
    </div>
  );
}

function Out({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised px-3 py-2">
      <dt className="text-xs text-text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm text-text">{value}</dd>
    </div>
  );
}
