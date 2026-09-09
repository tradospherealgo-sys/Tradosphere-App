import { getMyOrders, getMyPaperAccount } from "@/lib/trading/actions";
import { getTradableInstruments } from "@/lib/app-data/reads";
import { EmptyState } from "@/components/empty-state";
import { OrderForm } from "./order-form";
import { OrderBook } from "./order-book";
import { ResetAccountButton } from "./reset-account-button";

export const dynamic = "force-dynamic";

/**
 * The ticket accepts a prefill from a signal detail page (`?signal=…`). The
 * levels come in through the URL, but the *fill* still comes from the live
 * provider server-side — a prefilled entry price is only ever used for
 * position sizing, never as the traded price.
 */
export default async function PaperTradingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const [account, orders, instruments] = await Promise.all([
    getMyPaperAccount(),
    getMyOrders(),
    getTradableInstruments(),
  ]);

  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" ? v : "";
  };
  const prefillSymbol = one("symbol");
  const prefill = prefillSymbol
    ? {
        symbol: prefillSymbol.toUpperCase(),
        side: one("side") === "SELL" ? ("SELL" as const) : ("BUY" as const),
        referencePrice: one("entry"),
        stopLoss: one("sl"),
        target: one("target"),
        signalId: one("signal") || null,
      }
    : undefined;

  const resting = orders.filter((order) => order.status === "PENDING");
  const history = orders.filter((order) => order.status !== "PENDING");
  // Cash a resting BUY has already committed is not available to spend again.
  const availableCash = account
    ? account.cash_balance - account.reserved_cash
    : 0;

  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">Paper Trading</h1>
        <p className="mt-1 text-sm text-text-muted">
          Simulation only — no real money moves. Orders fill at a real,
          live-quoted price pulled from the active market-data provider; if no
          live quote is available the order is rejected rather than filled at a
          guessed price.
        </p>
        {account && (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="text-text-muted">
              Cash available:{" "}
              <span className="text-text">
                {account.currency} {availableCash.toLocaleString("en-IN")}
              </span>
            </span>
            {account.reserved_cash > 0 && (
              <span className="text-text-muted">
                Blocked by open orders:{" "}
                <span className="text-text">
                  {account.currency} {account.reserved_cash.toLocaleString("en-IN")}
                </span>
              </span>
            )}
            <span className="text-text-muted">
              Risk per trade: <span className="text-text">{account.risk_per_trade_pct}%</span>
            </span>
            <ResetAccountButton />
          </div>
        )}
      </header>

      <section className="rounded-2xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-4 text-sm font-medium text-text">Place order</h2>
        <OrderForm
          instruments={instruments}
          equity={account?.starting_capital ?? 0}
          riskPct={account?.risk_per_trade_pct ?? 1}
          availableCash={availableCash}
          currency={account?.currency ?? "INR"}
          prefill={prefill}
        />
      </section>

      <OrderBook orders={resting} />

      <section>
        <h2 className="mb-3 text-sm font-medium text-text">Order history</h2>
        {history.length === 0 ? (
          <EmptyState title="No orders yet" />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-text-faint">
                  <th className="px-4 py-2 font-normal">Symbol</th>
                  <th className="px-4 py-2 font-normal">Type</th>
                  <th className="px-4 py-2 font-normal">Side</th>
                  <th className="px-4 py-2 font-normal">Qty</th>
                  <th className="px-4 py-2 font-normal">Fill price</th>
                  <th className="px-4 py-2 font-normal">Charges</th>
                  <th className="px-4 py-2 font-normal">SL / Target</th>
                  <th className="px-4 py-2 font-normal">Status</th>
                  <th className="px-4 py-2 font-normal">Reason</th>
                  <th className="px-4 py-2 font-normal">When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="px-4 py-2 text-text">{o.symbol}</td>
                    <td className="px-4 py-2 text-text-muted">
                      {o.variety === "SL_M" ? "SL-M" : o.variety} · {o.product}
                    </td>
                    <td className={`px-4 py-2 ${o.side === "BUY" ? "text-up" : "text-down"}`}>
                      {o.side}
                    </td>
                    <td className="px-4 py-2 text-text-muted">{o.quantity}</td>
                    <td className="px-4 py-2 text-text-muted">{o.avg_fill_price ?? "—"}</td>
                    <td className="px-4 py-2 text-text-faint">
                      {o.status === "FILLED" ? o.total_charges.toFixed(2) : "—"}
                    </td>
                    <td className="px-4 py-2 text-text-faint">
                      {o.stop_loss ?? "—"} / {o.target_price ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-text-muted">{o.status}</td>
                    <td className="px-4 py-2 text-text-faint">{o.reject_reason ?? "—"}</td>
                    <td className="px-4 py-2 text-text-faint">
                      {new Date(o.created_at).toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}
