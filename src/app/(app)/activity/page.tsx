import {
  getMyOrders,
  getMyPaperAccount,
  getMyPositions,
  getMyTrades,
} from "@/lib/trading/actions";
import { calcTradeStats, buildEquityCurve, calcDrawdown } from "@/lib/analytics/stats";
import { EquitySparkline } from "@/components/equity-sparkline";
import { EmptyState } from "@/components/empty-state";
import { PositionSizer } from "./position-sizer";

export const dynamic = "force-dynamic";

/**
 * Risk, analytics and journal — all of it derived from rows the paper
 * engine actually wrote. Nothing here is modelled or back-filled, so an
 * account with no closed trades shows dashes rather than a zeroed-out
 * statistics panel that would read as real performance.
 */
export default async function ActivityPage() {
  const [orders, trades, positions, { account }] = await Promise.all([
    getMyOrders(),
    getMyTrades(),
    getMyPositions(),
    getMyPaperAccount(),
  ]);

  const currency = account?.currency ?? "INR";
  const stats = calcTradeStats(trades);
  const startingCapital = account?.starting_capital ?? 0;
  const curve = buildEquityCurve(trades, startingCapital);
  const drawdown = calcDrawdown(curve);

  const fmt = (n: number | null) =>
    n === null
      ? "—"
      : new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency,
          maximumFractionDigits: 2,
        }).format(n);

  const entries = [
    ...orders.map((o) => ({
      id: `order-${o.id}`,
      when: o.created_at,
      kind: o.status === "REJECTED" ? "Order rejected" : "Order filled",
      bad: o.status === "REJECTED",
      detail: `${o.side} ${o.quantity} ${o.symbol} @ ${o.price}${
        o.reject_reason ? ` — ${o.reject_reason}` : ""
      }`,
    })),
    ...trades.map((t) => ({
      id: `trade-${t.id}`,
      when: t.closed_at,
      kind: "Trade closed",
      bad: t.net_realized_pnl < 0,
      detail: `${t.symbol} ${t.side} ${t.quantity} — net ${fmt(t.net_realized_pnl)} after ${fmt(t.total_charges)} charges`,
    })),
  ].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">
          Risk, analytics &amp; journal
        </h1>
        <p className="text-sm text-text-muted">
          Every figure below comes from your own closed paper trades. Open
          positions are excluded — the curve only moves on a booked result.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="Win rate"
          value={stats.winRate === null ? "—" : `${stats.winRate}%`}
          sub={`${stats.wins}W / ${stats.losses}L${
            stats.breakEven > 0 ? ` / ${stats.breakEven} flat` : ""
          }`}
        />
        <Metric
          label="Net realized P&L"
          value={stats.totalTrades === 0 ? "—" : fmt(stats.netPnl)}
          tone={stats.netPnl >= 0 ? "up" : "down"}
          sub={`${stats.totalTrades} closed trades`}
        />
        <Metric
          label="Expectancy"
          value={fmt(stats.expectancy)}
          sub="Average P&L per trade"
        />
        <Metric
          label="Profit factor"
          value={stats.profitFactor === null ? "—" : stats.profitFactor.toFixed(2)}
          sub={
            stats.profitFactor === null && stats.totalTrades > 0
              ? "No losing trade yet"
              : "Gross profit ÷ gross loss"
          }
        />
        <Metric label="Average win" value={fmt(stats.avgWin)} tone="up" />
        <Metric label="Average loss" value={fmt(stats.avgLoss)} tone="down" />
        <Metric
          label="Best / worst"
          value={
            stats.bestTrade === null
              ? "—"
              : `${fmt(stats.bestTrade)} / ${fmt(stats.worstTrade)}`
          }
        />
        <Metric
          label="Average R"
          value={stats.avgRMultiple === null ? "—" : `${stats.avgRMultiple}R`}
          sub="Across trades that had a stop"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-text">Equity curve</h2>
            <p className="text-xs text-text-faint">
              from {fmt(startingCapital)}
            </p>
          </div>
          {curve.length < 2 ? (
            <p className="mt-4 text-xs text-text-faint">
              Close at least two trades to plot a curve.
            </p>
          ) : (
            <>
              <div className="mt-3">
                <EquitySparkline points={curve} />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <Small label="Peak equity" value={fmt(drawdown.peakEquity)} />
                <Small label="Max drawdown" value={fmt(drawdown.maxDrawdown)} />
                <Small
                  label="Max drawdown %"
                  value={
                    drawdown.maxDrawdownPct === null
                      ? "—"
                      : `${drawdown.maxDrawdownPct}%`
                  }
                />
              </dl>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-text">Exposure</h2>
          <dl className="mt-3 space-y-2 text-xs">
            <Small label="Open positions" value={String(positions.length)} />
            <Small
              label="Risk per trade"
              value={
                account ? `${account.risk_per_trade_pct}%` : "—"
              }
            />
            <Small label="Available cash" value={fmt(account?.cash_balance ?? null)} />
            <Small
              label="Gross profit / loss"
              value={
                stats.totalTrades === 0
                  ? "—"
                  : `${fmt(stats.grossProfit)} / ${fmt(stats.grossLoss)}`
              }
            />
          </dl>
        </div>
      </section>

      <PositionSizer
        equity={account?.cash_balance ?? null}
        defaultRiskPct={account?.risk_per_trade_pct ?? 1}
        currency={currency}
      />

      <section>
        <h2 className="mb-3 text-sm font-medium text-text">Trade journal</h2>
        {trades.length === 0 ? (
          <EmptyState
            title="No closed trades yet"
            body="Close a paper position and it will be journaled here with its R-multiple."
          />
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs text-text-faint">
                  <Th>Symbol</Th>
                  <Th>Side</Th>
                  <Th>Qty</Th>
                  <Th>Entry</Th>
                  <Th>Exit</Th>
                  <Th>Net P&L</Th>
                  <Th>R</Th>
                  <Th>Closed</Th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <Td className="text-text">{t.symbol}</Td>
                    <Td className={t.side === "BUY" ? "text-up" : "text-down"}>
                      {t.side}
                    </Td>
                    <Td>{t.quantity}</Td>
                    <Td>{t.entry_price}</Td>
                    <Td>{t.exit_price}</Td>
                    <Td className={t.net_realized_pnl >= 0 ? "text-up" : "text-down"}>
                      {fmt(t.net_realized_pnl)}
                    </Td>
                    <Td className="text-text-faint">
                      {t.r_multiple === null ? "—" : `${t.r_multiple}R`}
                    </Td>
                    <Td className="whitespace-nowrap text-text-faint">
                      {new Date(t.closed_at).toLocaleString("en-IN")}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text">Activity log</h2>
        {entries.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className={e.bad ? "text-down" : "text-text"}>{e.kind}</p>
                  <p className="break-words text-text-muted">{e.detail}</p>
                </div>
                <p className="shrink-0 text-xs text-text-faint">
                  {new Date(e.when).toLocaleString("en-IN")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs text-text-faint">{label}</p>
      <p
        className={`mt-1 text-base font-medium ${
          value === "—"
            ? "text-text-faint"
            : tone === "up"
              ? "text-up"
              : tone === "down"
                ? "text-down"
                : "text-text"
        }`}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-text-muted">{sub}</p> : null}
    </div>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-text-faint">{label}</dt>
      <dd className="text-text">{value}</dd>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-normal">{children}</th>;
}

function Td({
  children,
  className = "text-text-muted",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
