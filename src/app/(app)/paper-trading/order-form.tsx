"use client";

import { useMemo, useState, useTransition } from "react";
import { placeOrder } from "@/lib/trading/actions";
import { calcPositionSize, calcRiskReward } from "@/lib/trading/risk";
import type { InstrumentKind, OrderSide } from "@/types/database";

type InstrumentOption = {
  symbol: string;
  name: string | null;
  instrument_kind: InstrumentKind;
  lot_size: number;
};

/**
 * The order ticket.
 *
 * Deliberately shows no price of its own. The fill price is whatever the
 * server gets back from the live provider at submit time, so quoting a
 * number here would either be stale or invented. The risk panel therefore
 * sizes off a *reference* price the user types — labelled as such — and the
 * confirmation message reports the price the order actually filled at.
 */
export type OrderPrefill = {
  symbol: string;
  side: OrderSide;
  referencePrice: string;
  stopLoss: string;
  target: string;
  signalId: string | null;
};

export function OrderForm({
  instruments,
  equity,
  riskPct,
  prefill,
}: {
  instruments: InstrumentOption[];
  equity: number;
  riskPct: number;
  prefill?: OrderPrefill;
}) {
  const [symbol, setSymbol] = useState(prefill?.symbol ?? "");
  const [side, setSide] = useState<OrderSide>(prefill?.side ?? "BUY");
  const [quantity, setQuantity] = useState(1);
  const [referencePrice, setReferencePrice] = useState(prefill?.referencePrice ?? "");
  const [stopLoss, setStopLoss] = useState(prefill?.stopLoss ?? "");
  const [target, setTarget] = useState(prefill?.target ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = instruments.find(
    (i) => i.symbol.toUpperCase() === symbol.trim().toUpperCase()
  );

  const sizing = useMemo(() => {
    const entry = Number(referencePrice);
    const stop = Number(stopLoss);
    if (!entry || !stop) return null;
    return calcPositionSize({
      equity,
      riskPct,
      entryPrice: entry,
      stopLoss: stop,
      lotSize: selected?.lot_size ?? 1,
    });
  }, [referencePrice, stopLoss, equity, riskPct, selected]);

  const riskReward = useMemo(() => {
    const entry = Number(referencePrice);
    const stop = Number(stopLoss);
    const tgt = Number(target);
    if (!entry || !stop || !tgt) return null;
    return calcRiskReward({ side, entryPrice: entry, stopLoss: stop, targetPrice: tgt });
  }, [side, referencePrice, stopLoss, target]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const res = await placeOrder({
            symbol,
            side,
            quantity,
            instrumentKind: selected?.instrument_kind ?? "EQUITY",
            stopLoss: stopLoss ? Number(stopLoss) : null,
            targetPrice: target ? Number(target) : null,
            signalId: prefill?.signalId ?? null,
          });
          if (res.ok) {
            setMessage({
              ok: true,
              text: `Filled: ${res.order.side} ${res.order.quantity} ${res.order.symbol} @ ${res.order.price}`,
            });
            setSymbol("");
            setStopLoss("");
            setTarget("");
            setReferencePrice("");
          } else {
            setMessage({ ok: false, text: res.error });
          }
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs text-text-faint">Symbol</label>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            required
            list="instrument-options"
            autoCapitalize="characters"
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
            placeholder="e.g. RELIANCE"
          />
          <datalist id="instrument-options">
            {instruments.map((i) => (
              <option key={i.symbol} value={i.symbol}>
                {i.name ?? i.symbol}
              </option>
            ))}
          </datalist>
        </div>

        <div>
          <label className="block text-xs text-text-faint">Side</label>
          <select
            value={side}
            onChange={(e) => setSide(e.target.value as OrderSide)}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          >
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-text-faint">
            Quantity{selected && selected.lot_size > 1 ? ` (lot ${selected.lot_size})` : ""}
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          />
        </div>

        <div>
          <label className="block text-xs text-text-faint">Reference price</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.05"
            value={referencePrice}
            onChange={(e) => setReferencePrice(e.target.value)}
            placeholder="for sizing only"
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          />
        </div>

        <div>
          <label className="block text-xs text-text-faint">Stop loss</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.05"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            placeholder="optional"
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          />
        </div>

        <div>
          <label className="block text-xs text-text-faint">Target</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.05"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="optional"
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          />
        </div>
      </div>

      {(sizing || riskReward !== null) && (
        <div className="rounded-xl border border-border bg-bg px-4 py-3 text-xs text-text-muted">
          <p className="mb-1 text-text-faint">
            Sizing at {riskPct}% of {equity.toLocaleString("en-IN")}, against your
            reference price — the order still fills at the live quote.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {sizing && (
              <>
                <span>
                  Risk budget:{" "}
                  <span className="text-text">{sizing.riskAmount.toLocaleString("en-IN")}</span>
                </span>
                <span>
                  Suggested qty: <span className="text-text">{sizing.quantity}</span>
                  {sizing.lots > 0 && selected && selected.lot_size > 1
                    ? ` (${sizing.lots} lot${sizing.lots > 1 ? "s" : ""})`
                    : ""}
                </span>
                <span>
                  Actual risk:{" "}
                  <span className="text-text">{sizing.actualRisk.toLocaleString("en-IN")}</span>
                </span>
              </>
            )}
            {riskReward !== null && (
              <span>
                R:R: <span className="text-text">{riskReward}</span>
              </span>
            )}
          </div>
          {sizing?.quantity === 0 && (
            <p className="mt-1 text-warn">
              One lot would exceed your risk budget at this stop distance.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-lg bg-accent px-5 text-sm font-medium text-bg hover:bg-accent-strong disabled:opacity-50"
        >
          {pending ? "Placing…" : "Place order"}
        </button>
        {sizing && sizing.quantity > 0 && sizing.quantity !== quantity && (
          <button
            type="button"
            onClick={() => setQuantity(sizing.quantity)}
            className="h-11 rounded-lg border border-border px-4 text-sm text-text-muted hover:border-accent hover:text-text"
          >
            Use {sizing.quantity}
          </button>
        )}
      </div>

      {message && (
        <p className={`text-xs ${message.ok ? "text-up" : "text-down"}`}>{message.text}</p>
      )}
    </form>
  );
}
