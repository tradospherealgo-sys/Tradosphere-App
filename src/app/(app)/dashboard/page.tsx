import Link from "next/link";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  GraduationCap,
  LineChart,
  ListOrdered,
  PieChart,
  Radio,
  Wallet,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getMyPaperAccount,
  getMyPositions,
  getMyOrders,
  getMyTrades,
} from "@/lib/trading/actions";
import { getMyWatchlists, getTradableInstruments } from "@/lib/app-data/reads";
import { getLiveSignals } from "@/lib/signals/reads";
import { getActiveMarketDataProvider } from "@/lib/market-data";
import type { Quote } from "@/lib/market-data/types";
import { calcAllocation, valuePositions } from "@/lib/analytics/valuation";
import { buildEquityCurve, calcDrawdown, calcTradeStats } from "@/lib/analytics/stats";
import { EquitySparkline } from "@/components/equity-sparkline";
import { SignalCard } from "@/components/signal-card";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

/**
 * A dash on this page always means "we don't know", never "it is zero".
 * Every figure that depends on a live price is null unless the provider
 * actually returned one, so an unconfigured provider produces visible gaps
 * rather than a plausible-looking but invented portfolio.
 */
function money(n: number | null, currency: string): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

function timeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function tone(n: number | null): string {
  if (n === null) return "text-text-muted";
  if (n > 0) return "text-up";
  if (n < 0) return "text-down";
  return "text-text";
}

function Metric({
  label,
  value,
  sub,
  valueClass = "text-text",
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-text-faint">{label}</p>
      <p className={`mt-1.5 text-lg font-semibold tabular-nums md:text-2xl ${valueClass}`}>
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-text-faint">{sub}</p> : null}
    </div>
  );
}

function QuoteCard({ quote }: { quote: Quote }) {
  const change =
    quote.prevClose !== null ? quote.lastPrice - quote.prevClose : null;
  const changePct =
    change !== null && quote.prevClose ? (change / quote.prevClose) * 100 : null;
  const up = change !== null && change >= 0;
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium text-text">{quote.symbol}</p>
        {change !== null ? (
          up ? (
            <ArrowUpRight className="size-3.5 shrink-0 text-up" aria-hidden />
          ) : (
            <ArrowDownRight className="size-3.5 shrink-0 text-down" aria-hidden />
          )
        ) : null}
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums text-text">
        {quote.lastPrice.toFixed(2)}
      </p>
      <p className={`text-xs tabular-nums ${tone(change)}`}>
        {change === null
          ? "no previous close"
          : `${change >= 0 ? "+" : ""}${change.toFixed(2)}${
              changePct !== null ? ` (${changePct.toFixed(2)}%)` : ""
            }`}
      </p>
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  children,
}: {
  icon: typeof Wallet;
  children: React.ReactNode;
}) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-faint">
      <Icon className="size-3.5" aria-hidden />
      {children}
    </p>
  );
}

export default async function DashboardPage() {
  const [
    { user, profile },
    { account, error: accountError },
    positions,
    orders,
    trades,
    watchlists,
    instruments,
    signals,
  ] = await Promise.all([
    getCurrentUser(),
    getMyPaperAccount(),
    getMyPositions(),
    getMyOrders(),
    getMyTrades(),
    getMyWatchlists(),
    getTradableInstruments(),
    getLiveSignals(6),
  ]);

  const indexSymbols = instruments.filter((i) => i.is_index).map((i) => i.symbol);
  const watchSymbols = watchlists.flatMap((w) =>
    (w.watchlist_items ?? []).map((it) => it.symbol)
  );
  const positionSymbols = positions.map((p) => p.symbol);

  // One batch call for every symbol the page needs — indices, watchlist and
  // open positions share a single provider round-trip.
  const wanted = Array.from(
    new Set([...indexSymbols, ...watchSymbols, ...positionSymbols].map((s) => s.toUpperCase()))
  );

  const provider = await getActiveMarketDataProvider();
  const configured = provider.isConfigured();
  const quotes: Quote[] =
    configured && wanted.length > 0 ? await provider.getQuotes(wanted) : [];
  const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  const currency = account?.currency ?? "INR";
  const valuation = valuePositions(positions, quotes);
  const allocation = calcAllocation(valuation);
  const stats = calcTradeStats(trades);
  const curve = buildEquityCurve(trades, account?.starting_capital ?? 0);
  const drawdown = calcDrawdown(curve);

  const cash = account?.cash_balance ?? null;
  const totalEquity =
    cash !== null && valuation.marketValue !== null
      ? cash + valuation.marketValue
      : positions.length === 0
        ? cash
        : null;

  const indexQuotes = indexSymbols
    .map((s) => bySymbol.get(s.toUpperCase()))
    .filter((q): q is Quote => q !== undefined);
  const watchQuotes = Array.from(new Set(watchSymbols.map((s) => s.toUpperCase())))
    .map((s) => bySymbol.get(s))
    .filter((q): q is Quote => q !== undefined);

  const recentOrders = orders.slice(0, 6);
  // A brand-new account has nothing to report on yet. Seven metric tiles
  // reading "—" reads as broken, not new — so a first-time visitor gets one
  // compact prompt instead of the full grid, and the grid returns once
  // there's a position or a closed trade to actually show.
  const isNewUser = positions.length === 0 && trades.length === 0;

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">
          Good {timeOfDay()}, {(profile?.full_name ?? user?.email ?? "Trader").split(" ")[0]}
        </h1>
        <p className="text-sm text-text-muted">
          Discipline today. Freedom tomorrow. Educational, simulation-only
          account — no real money or live broker execution is involved.
        </p>
      </header>

      {!account ? (
        <EmptyState
          title={
            accountError
              ? "Couldn't load your paper trading account"
              : "No paper trading account found"
          }
          body={
            accountError
              ? "We hit an error checking your account rather than confirming it's missing. Try reloading; if it keeps happening, contact an admin."
              : "Your paper account should be created automatically on sign-up. If this persists, contact an admin."
          }
        />
      ) : !configured ? (
        <div className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm text-text-muted">
          No market-data provider is configured, so live prices and
          mark-to-market figures are unavailable. An admin can connect one under{" "}
          <Link href="/admin/integrations" className="text-accent underline">
            Admin → Integrations
          </Link>
          .
        </div>
      ) : valuation.unquoted > 0 ? (
        <div className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm text-text-muted">
          {valuation.unquoted} open position
          {valuation.unquoted === 1 ? " has" : "s have"} no live quote right now,
          so portfolio totals cannot be valued and are shown as “—”.
        </div>
      ) : null}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-text"><LineChart className="size-4 text-accent" aria-hidden />Indices</h2>
          <Link href="/markets" className="text-xs text-accent">
            Live market overview
          </Link>
        </div>
        {indexQuotes.length === 0 ? (
          <EmptyState
            title="No index quotes"
            body="Index prices appear once a market-data provider is connected and returning data."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {indexQuotes.map((q) => (
              <QuoteCard key={q.symbol} quote={q} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-gradient-to-br from-surface to-surface-raised p-5">
        <div className="flex items-center gap-2 text-xs text-text-faint">
          <Wallet className="size-3.5" aria-hidden />
          Total equity
        </div>
        <p className="mt-1 text-3xl font-semibold tabular-nums text-text md:text-4xl">
          {money(totalEquity, currency)}
        </p>
        <p className="mt-1 text-xs text-text-faint">Cash + market value</p>
      </section>

      {isNewUser ? (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <SectionHeading icon={Activity}>Account &amp; performance</SectionHeading>
          <p className="text-sm text-text-muted">
            You have {money(cash, currency)} in cash and no open positions or
            closed trades yet. P&amp;L, win rate and drawdown will appear here
            once you have activity to show.
          </p>
        </section>
      ) : (
        <>
          <section>
            <SectionHeading icon={Wallet}>Account</SectionHeading>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric label="Available cash" value={money(cash, currency)} />
              <Metric
                label="Day P&L"
                value={money(valuation.dayPnl, currency)}
                valueClass={tone(valuation.dayPnl)}
                sub="Since previous close"
              />
              <Metric
                label="Open positions"
                value={String(positions.length)}
                sub={money(valuation.investedAtCost, currency) + " at cost"}
              />
              <Metric
                label="Unrealized P&L"
                value={money(valuation.unrealizedPnl, currency)}
                valueClass={tone(valuation.unrealizedPnl)}
              />
            </div>
          </section>

          <section>
            <SectionHeading icon={Activity}>Performance</SectionHeading>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <Metric
                label="Realized P&L"
                value={trades.length === 0 ? "—" : money(stats.netPnl, currency)}
                valueClass={tone(trades.length === 0 ? null : stats.netPnl)}
                sub={`${stats.totalTrades} closed trades`}
              />
              <Metric
                label="Win rate"
                value={stats.winRate === null ? "—" : `${stats.winRate}%`}
                sub={
                  stats.winRate === null
                    ? "no decided trades"
                    : `${stats.wins}W / ${stats.losses}L`
                }
              />
              <Metric
                label="Max drawdown"
                value={
                  curve.length < 2
                    ? "—"
                    : money(-drawdown.maxDrawdown, currency)
                }
                valueClass={curve.length < 2 ? "text-text" : tone(-drawdown.maxDrawdown)}
                sub={
                  curve.length < 2 || drawdown.maxDrawdownPct === null
                    ? undefined
                    : `${drawdown.maxDrawdownPct}% from peak`
                }
              />
            </div>
          </section>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-medium text-text"><Activity className="size-4 text-accent" aria-hidden />Equity curve</h2>
            <span className="text-xs text-text-faint">realized only</span>
          </div>
          {curve.length < 2 ? (
            <EmptyState
              title="Not enough history"
              body="The equity curve appears once you have closed at least one paper trade."
            />
          ) : (
            <>
              <EquitySparkline points={curve} />
              <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <div>
                  <dt className="text-text-faint">Expectancy</dt>
                  <dd className={`mt-1 tabular-nums ${tone(stats.expectancy)}`}>
                    {money(stats.expectancy, currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-faint">Profit factor</dt>
                  <dd className="mt-1 tabular-nums text-text">
                    {stats.profitFactor === null ? "—" : stats.profitFactor}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-faint">Peak equity</dt>
                  <dd className="mt-1 tabular-nums text-text">
                    {money(drawdown.peakEquity, currency)}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-text"><PieChart className="size-4 text-accent" aria-hidden />Allocation</h2>
          {allocation.length === 0 ? (
            <EmptyState
              title="Nothing to allocate"
              body="Allocation is computed from open positions at live market value."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {allocation.map((slice) => (
                <li key={slice.symbol}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-text">{slice.symbol}</span>
                    <span className="tabular-nums text-text-muted">
                      {slice.pct}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-raised">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.min(slice.pct, 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="border-t border-border pt-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-text"><LineChart className="size-4 text-accent" aria-hidden />Watchlist</h2>
          <Link href="/markets" className="text-xs text-accent">
            Manage
          </Link>
        </div>
        {watchQuotes.length === 0 ? (
          <EmptyState
            title="No watchlist quotes"
            body="Add symbols to a watchlist to track their live prices here."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {watchQuotes.map((q) => (
              <QuoteCard key={q.symbol} quote={q} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-text"><ListOrdered className="size-4 text-accent" aria-hidden />Recent activity</h2>
        </div>
        {recentOrders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            body="Activity will appear here once you have orders."
          />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-text-faint">
                  <th className="pb-2 font-normal">Symbol</th>
                  <th className="pb-2 font-normal">Side</th>
                  <th className="pb-2 font-normal">Qty</th>
                  <th className="pb-2 font-normal">Price</th>
                  <th className="pb-2 font-normal">Status</th>
                  <th className="pb-2 font-normal">When</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o) => (
                  <tr key={o.id} className="border-t border-border odd:bg-surface-raised/30">
                    <td className="py-2 text-text">{o.symbol}</td>
                    <td className={`py-2 ${o.side === "BUY" ? "text-up" : "text-down"}`}>
                      {o.side}
                    </td>
                    <td className="py-2 tabular-nums text-text-muted">{o.quantity}</td>
                    <td className="py-2 tabular-nums text-text-muted">{o.price}</td>
                    <td className="py-2 text-text-muted">{o.status}</td>
                    <td className="py-2 text-text-faint">
                      {new Date(o.created_at).toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border-t border-border pt-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-text"><Radio className="size-4 text-accent" aria-hidden />Live signals</h2>
          <Link href="/signals" className="text-xs text-accent">
            All signals
          </Link>
        </div>
        {signals.length === 0 ? (
          <EmptyState
            title="No active signals"
            body="Verified signals from trusted desks appear here as they are released."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {signals.map((s) => (
              <SignalCard key={s.id} signal={s} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-gradient-to-br from-surface to-surface-raised p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-text">
            <GraduationCap className="size-4 text-accent" aria-hidden />
            Continue learning
          </h2>
          <Link href="/education" className="text-xs text-accent">
            Education &amp; Coach
          </Link>
        </div>
        <p className="mt-1 text-sm text-text-muted">
          {isNewUser
            ? "New here? Start with the fundamentals before placing your first paper trade."
            : "Keep building your edge — lessons, market coaching and past sessions are all in one place."}
        </p>
        <Link
          href="/education"
          className="mt-3 inline-flex h-11 items-center rounded-lg border border-border px-4 text-sm text-text-muted hover:border-accent hover:text-text"
        >
          Go to Education
        </Link>
      </section>
    </div>
  );
}
