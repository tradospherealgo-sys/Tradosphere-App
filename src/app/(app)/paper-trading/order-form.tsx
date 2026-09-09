"use client";

import { useMemo, useState, useTransition } from "react";
import { placeOrder } from "@/lib/trading/actions";
import { calcPositionSize, calcRiskReward } from "@/lib/trading/risk";
import { calcCharges } from "@/lib/trading/charges";
import type {
  InstrumentKind,
  OrderProduct,
  OrderSide,
  OrderVariety,
} from "@/types/database";

type InstrumentOption = {
  symbol: string;
  name: string | null;
  instrument_kind: InstrumentKind;
  lot_size: number;
};

/**
 * The order ticket.
 *
 * Deliberately quotes no price of its own. A market order fills at whatever
 * the server gets back from the live provider at submit time, so a number
 * shown here would either be stale or invented. Sizing therefore works off a
 * *reference* price — the limit/trigger for a resting order, or a figure the
 * user types for a market order — and every panel that uses it says so.
 *
 * The charges panel is an estimate produced by the same rate table the
 * database uses, but the database's own computation is what the account is
 * actually debited. Nothing here is sent to the server as a charge.
 */
export type OrderPrefill = {
  symbol: string;
  side: OrderSide;
  referencePrice: string;
  stopLoss: string;
  target: string;
  signalId: string | null;
};

const VARIETIES: { value: OrderVariety; label: string; hint: string }[] = [
  { value: "MARKET", label: "Market", hint: "Fills now at the live quote." },
  { value: "LIMIT", label: "Limit", hint: "Rests until the market reaches your price." },
  { value: "SL", label: "SL", hint: "Stop trigger, with a limit capping the fill." },
  { value: "SL_M", label: "SL-M", hint: "Stop trigger, then fills at the market." },
];

export function OrderForm({
  instruments,
  equity,
  riskPct,
  availableCash,
  currency,
  prefill,
}: {
  instruments: InstrumentOption[];
  equity: number;
  riskPct: number;
  availableCash: number;
  currency: string;
  prefill?: OrderPrefill;
}) {
  const [symbol, setSymbol] = useState(prefill?.symbol ?? "");
  const [side, setSide] = useState<OrderSide>(prefill?.side ?? "BUY");
  const [variety, setVariety] = useState<OrderVariety>("MARKET");
  const [product, setProduct] = useState<OrderProduct>("MIS");
  const [quantity, setQuantity] = useState(1);
  const [referencePrice, setReferencePrice] = useState(prefill?.referencePrice ?? "");
  const [limitPrice, setLimitPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [stopLoss, setStopLoss] = useState(prefill?.stopLoss ?? "");
  const [target, setTarget] = useState(prefill?.target ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = instruments.find(
    (i) => i.symbol.toUpperCase() === symbol.trim().toUpperCase()
  );

  const needsLimit = variety === "LIMIT" || variety === "SL";
  const needsTrigger = variety === "SL" || variety === "SL_M";

  // For a resting order the price that defines it is the honest basis for
  // sizing and cost. Only a market order has to fall back on a typed guess.
  const basis = useMemo(() => {
    const pick = needsLimit ? limitPrice : needsTrigger ? triggerPrice : referencePrice;
    const value = Number(pick);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [needsLimit, needsTrigger, limitPrice, triggerPrice, referencePrice]);

  const sizing = useMemo(() => {
    const stop = Number(stopLoss);
    if (!basis || !stop) return null;
    return calcPositionSize({
      equity,
      riskPct,
      entryPrice: basis,
      stopLoss: stop,
      lotSize: selected?.lot_size ?? 1,
    });
  }, [basis, stopLoss, equity, riskPct, selected]);

  const riskReward = useMemo(() => {
    const stop = Number(stopLoss);
    const tgt = Number(target);
    if (!basis || !stop || !tgt) return null;
    return calcRiskReward({ side, entryPrice: basis, stopLoss: stop, targetPrice: tgt });
  }, [side, basis, stopLoss, target]);

  const estimate = useMemo(() => {
    if (!basis || !quantity || quantity <= 0) return null;
    const turnover = basis * quantity;
    const charges = calcCharges(side, product, turnover);
    return {
      turnover,
      charges,
      // A buy costs the notional plus charges; a sell returns it net of them.
      cashImpact: side === "BUY" ? turnover + charges.total : turnover - charges.total,
    };
  }, [basis, quantity, side, product]);

  const shortfall =
    estimate && side === "BUY" ? estimate.cashImpact - availableCash : 0;

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
            variety,
            product,
            limitPrice: needsLimit ? Number(limitPrice) : null,
            triggerPrice: needsTrigger ? Number(triggerPrice) : null,
            instrumentKind: selected?.instrument_kind ?? "EQUITY",
            stopLoss: stopLoss ? Number(stopLoss) : null,
            targetPrice: target ? Number(target) : null,
            signalId: prefill?.signalId ?? null,
          });
          if (res.ok) {
            setMessage({
              ok: true,
              text:
                res.order.status === "FILLED"
                  ? `Filled: ${res.order.side} ${res.order.quantity} ${res.order.symbol} @ ${res.order.avg_fill_price} · charges ${res.order.total_charges}`
                  : `Order resting: ${res.order.side} ${res.order.quantity} ${res.order.symbol} (${res.order.variety}). It fills when the market reaches your price.`,
            });
            setSymbol("");
            setStopLoss("");
            setTarget("");
            setReferencePrice("");
            setLimitPrice("");
            setTriggerPrice("");
          } else {
            setMessage({ ok: false, text: res.error });
          }
        });
      }}
    >
      <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1">
        {VARIETIES.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.hint}
            onClick={() => setVariety(option.value)}
            aria-pressed={variety === option.value}
            className={`h-9 rounded-md px-3 text-xs ${
              variety === option.value ? "bg-accent/15 text-text" : "text-text-muted"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs text-text-faint" htmlFor="order-symbol">
            Symbol
          </label>
          <input
            id="order-symbol"
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
          <label className="block text-xs text-text-faint" htmlFor="order-side">
            Side
          </label>
          <select
            id="order-side"
            value={side}
            onChange={(e) => setSide(e.target.value as OrderSide)}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          >
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-text-faint" htmlFor="order-product">
            Product
          </label>
          <select
            id="order-product"
            value={product}
            onChange={(e) => setProduct(e.target.value as OrderProduct)}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          >
            <option value="MIS">MIS (intraday)</option>
            <option value="CNC">CNC (delivery)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-text-faint" htmlFor="order-qty">
            Quantity{selected && selected.lot_size > 1 ? ` (lot ${selected.lot_size})` : ""}
          </label>
          <input
            id="order-qty"
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          />
        </div>

        {needsLimit && (
          <div>
            <label className="block text-xs text-text-faint" htmlFor="order-limit">
              Limit price
            </label>
            <input
              id="order-limit"
              type="number"
              inputMode="decimal"
              step="0.05"
              required
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
            />
          </div>
        )}

        {needsTrigger && (
          <div>
            <label className="block text-xs text-text-faint" htmlFor="order-trigger">
              Trigger price
            </label>
            <input
              id="order-trigger"
              type="number"
              inputMode="decimal"
              step="0.05"
              required
              value={triggerPrice}
              onChange={(e) => setTriggerPrice(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
            />
          </div>
        )}

        {variety === "MARKET" && (
          <div>
            <label className="block text-xs text-text-faint" htmlFor="order-reference">
              Reference price
            </label>
            <input
              id="order-reference"
              type="number"
              inputMode="decimal"
              step="0.05"
              value={referencePrice}
              onChange={(e) => setReferencePrice(e.target.value)}
              placeholder="for sizing only"
              className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
            />
          </div>
        )}

        <div>
          <label className="block text-xs text-text-faint" htmlFor="order-sl">
            Stop loss
          </label>
          <input
            id="order-sl"
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
          <label className="block text-xs text-text-faint" htmlFor="order-target">
            Target
          </label>
          <input
            id="order-target"
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

      {estimate && (
        <div className="rounded-xl border border-border bg-bg px-4 py-3 text-xs text-text-muted">
          <p className="mb-2 text-text-faint">
            Estimated cost at {currency} {basis?.toLocaleString("en-IN")} — the
            account is debited using the exchange&rsquo;s own figures computed
            server-side at fill.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              Turnover: <span className="text-text">{money(estimate.turnover)}</span>
            </span>
            <span>
              Brokerage: <span className="text-text">{money(estimate.charges.brokerage)}</span>
            </span>
            <span>
              STT: <span className="text-text">{money(estimate.charges.stt)}</span>
            </span>
            <span>
              Exchange + SEBI:{" "}
              <span className="text-text">
                {money(estimate.charges.exchangeCharges + estimate.charges.sebiCharges)}
              </span>
            </span>
            <span>
              Stamp: <span className="text-text">{money(estimate.charges.stampDuty)}</span>
            </span>
            <span>
              GST: <span className="text-text">{money(estimate.charges.gst)}</span>
            </span>
            <span>
              Total charges:{" "}
              <span className="text-text">{money(estimate.charges.total)}</span>
            </span>
            <span>
              {side === "BUY" ? "Cash required" : "Net proceeds"}:{" "}
              <span className="text-text">{money(estimate.cashImpact)}</span>
            </span>
          </div>
          {shortfall > 0 && (
            <p className="mt-2 text-down">
              Short by {money(shortfall)} — available buying power is{" "}
              {money(availableCash)}. The server will reject this order.
            </p>
          )}
        </div>
      )}

      {(sizing || riskReward !== null) && (
        <div className="rounded-xl border border-border bg-bg px-4 py-3 text-xs text-text-muted">
          <p className="mb-1 text-text-faint">
            Sizing at {riskPct}% of {equity.toLocaleString("en-IN")}, against your{" "}
            {variety === "MARKET" ? "reference price" : "order price"}
            {variety === "MARKET" ? " — the order still fills at the live quote." : "."}
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
          {pending ? "Placing…" : variety === "MARKET" ? "Place order" : "Place resting order"}
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

function money(value: number): string {
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
