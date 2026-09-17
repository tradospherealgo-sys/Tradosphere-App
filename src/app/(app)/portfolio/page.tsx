import { History, Wallet } from "lucide-react";
import { getMyPositions, getMyTrades } from "@/lib/trading/actions";
import { getActiveMarketDataProvider } from "@/lib/market-data";
import { calcUnrealizedPnl } from "@/lib/trading/pnl";
import { EmptyState } from "@/components/empty-state";
import { ClosePositionButton } from "./close-position-button";

export default async function PortfolioPage() {
  const [positions, trades] = await Promise.all([getMyPositions(), getMyTrades()]);

  const provider = await getActiveMarketDataProvider();
  const symbols = Array.from(new Set(positions.map((p) => p.symbol)));
  const quotes = provider.isConfigured() && symbols.length > 0
    ? await provider.getQuotes(symbols)
    : [];
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q]));

  // After charges — the figure that matches what the cash balance actually did.
  const realizedTotal = trades.reduce((sum, t) => sum + t.net_realized_pnl, 0);
  const chargesTotal = trades.reduce((sum, t) => sum + t.total_charges, 0);

  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text">
          <Wallet className="size-5 text-accent" aria-hidden />
          Portfolio
        </h1>
        <p className="text-sm text-text-muted">
          Open positions (mark-to-market against live quotes when available)
          and closed-trade history.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text">Open positions</h2>
        {positions.length === 0 ? (
          <EmptyState title="No open positions" />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-raised/40 text-left text-xs uppercase tracking-wide text-text-faint">
                  <th className="px-4 py-2 font-normal">Symbol</th>
                  <th className="px-4 py-2 font-normal">Side</th>
                  <th className="px-4 py-2 font-normal">Qty</th>
                  <th className="px-4 py-2 font-normal">Avg price</th>
                  <th className="px-4 py-2 font-normal">LTP</th>
                  <th className="px-4 py-2 font-normal">SL / Target</th>
                  <th className="px-4 py-2 font-normal">Unrealized P&L</th>
                  <th className="px-4 py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const quote = quoteBySymbol.get(p.symbol);
                  const unrealized = quote
                    ? calcUnrealizedPnl({
                        side: p.side,
                        quantity: p.quantity,
                        avgPrice: p.avg_price,
                        lastPrice: quote.lastPrice,
                      })
                    : null;
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-border transition-colors hover:bg-surface-raised/30"
                    >
                      <td className="px-4 py-2 text-text">{p.symbol}</td>
                      <td className={`px-4 py-2 ${p.side === "BUY" ? "text-up" : "text-down"}`}>
                        {p.side}
                      </td>
                      <td className="px-4 py-2 text-text-muted">{p.quantity}</td>
                      <td className="px-4 py-2 text-text-muted">{p.avg_price}</td>
                      <td className="px-4 py-2 text-text-muted">{quote?.lastPrice ?? "—"}</td>
                      <td className="px-4 py-2 text-text-faint">
                        {p.stop_loss ?? "—"} / {p.target_price ?? "—"}
                      </td>
                      <td
                        className={`px-4 py-2 ${
                          unrealized === null
                            ? "text-text-faint"
                            : unrealized >= 0
                              ? "text-up"
                              : "text-down"
                        }`}
                      >
                        {unrealized ?? "no live quote"}
                      </td>
                      <td className="px-4 py-2">
                        <ClosePositionButton positionId={p.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-text">
            <History className="size-4 text-accent" aria-hidden />
            Trade history
          </h2>
          <p className="text-sm text-text-muted">
            Realized P&L after charges:{" "}
            <span className={realizedTotal >= 0 ? "text-up" : "text-down"}>
              {realizedTotal.toFixed(2)}
            </span>
            <span className="text-text-faint">
              {" "}
              (charges {chargesTotal.toFixed(2)})
            </span>
          </p>
        </div>
        {trades.length === 0 ? (
          <EmptyState title="No closed trades yet" />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-raised/40 text-left text-xs uppercase tracking-wide text-text-faint">
                  <th className="px-4 py-2 font-normal">Symbol</th>
                  <th className="px-4 py-2 font-normal">Side</th>
                  <th className="px-4 py-2 font-normal">Qty</th>
                  <th className="px-4 py-2 font-normal">Entry</th>
                  <th className="px-4 py-2 font-normal">Exit</th>
                  <th className="px-4 py-2 font-normal">Gross P&L</th>
                  <th className="px-4 py-2 font-normal">Charges</th>
                  <th className="px-4 py-2 font-normal">Net P&L</th>
                  <th className="px-4 py-2 font-normal">R</th>
                  <th className="px-4 py-2 font-normal">Closed</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t border-border transition-colors hover:bg-surface-raised/30"
                  >
                    <td className="px-4 py-2 text-text">{t.symbol}</td>
                    <td className={`px-4 py-2 ${t.side === "BUY" ? "text-up" : "text-down"}`}>
                      {t.side}
                    </td>
                    <td className="px-4 py-2 text-text-muted">{t.quantity}</td>
                    <td className="px-4 py-2 text-text-muted">{t.entry_price}</td>
                    <td className="px-4 py-2 text-text-muted">{t.exit_price}</td>
                    <td className={`px-4 py-2 ${t.realized_pnl >= 0 ? "text-up" : "text-down"}`}>
                      {t.realized_pnl}
                    </td>
                    <td className="px-4 py-2 text-text-faint">
                      {t.total_charges.toFixed(2)}
                    </td>
                    <td
                      className={`px-4 py-2 font-medium ${
                        t.net_realized_pnl >= 0 ? "text-up" : "text-down"
                      }`}
                    >
                      {t.net_realized_pnl}
                    </td>
                    <td className="px-4 py-2 text-text-faint">
                      {t.r_multiple === null ? "—" : `${t.r_multiple}R`}
                    </td>
                    <td className="px-4 py-2 text-text-faint">
                      {new Date(t.closed_at).toLocaleString("en-IN")}
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
