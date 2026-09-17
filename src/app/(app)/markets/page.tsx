import { ArrowDownRight, ArrowUpRight, LineChart, ListPlus } from "lucide-react";
import { getActiveMarketDataProvider } from "@/lib/market-data";
import { getMyWatchlists, getTradableInstruments } from "@/lib/app-data/reads";
import { EmptyState } from "@/components/empty-state";
import { WatchlistForm } from "./watchlist-form";

export default async function MarketsPage() {
  const [provider, watchlists, instruments] = await Promise.all([
    getActiveMarketDataProvider(),
    getMyWatchlists(),
    getTradableInstruments(),
  ]);

  const symbols = Array.from(
    new Set(watchlists.flatMap((w) => w.watchlist_items.map((i: { symbol: string }) => i.symbol)))
  );

  const quotes = provider.isConfigured() && symbols.length > 0
    ? await provider.getQuotes(symbols)
    : [];

  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text">
          <LineChart className="size-5 text-accent" aria-hidden />
          Live Market Overview
        </h1>
        <p className="text-sm text-text-muted">
          Real-time quotes for your watchlist symbols, from the active market-data
          provider. {!provider.isConfigured() && "No provider is currently configured."}
        </p>
      </header>

      {!provider.isConfigured() ? (
        <EmptyState
          title="No market-data provider configured"
          body="An admin needs to enable one in Admin → Integrations before live quotes can appear here."
        />
      ) : watchlists.length === 0 ? (
        <EmptyState
          title="Create your first watchlist"
          body="Give it a name below, then add symbols to start tracking live quotes here."
        />
      ) : symbols.length === 0 ? (
        <EmptyState
          title="Your watchlist is empty"
          body="Add symbols below to start tracking live quotes. Pick from the suggestions — a symbol without a live provider mapping yet will say so when you add it."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="-mx-0 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-raised/40 text-left text-xs uppercase tracking-wide text-text-faint">
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">LTP</th>
                  <th className="px-4 py-3 font-medium">Prev close</th>
                  <th className="px-4 py-3 font-medium">Day range</th>
                  <th className="px-4 py-3 font-medium">Volume</th>
                  <th className="px-4 py-3 font-medium">As of</th>
                </tr>
              </thead>
              <tbody>
                {quotes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-text-faint">
                      No live quotes returned for these symbols right now.
                    </td>
                  </tr>
                ) : (
                  quotes.map((q) => {
                    const change =
                      q.prevClose !== null ? q.lastPrice - q.prevClose : null;
                    return (
                      <tr
                        key={q.symbol}
                        className="border-t border-border transition-colors hover:bg-surface-raised/30"
                      >
                        <td className="px-4 py-2.5 font-medium text-text">{q.symbol}</td>
                        <td
                          className={`px-4 py-2.5 tabular-nums ${
                            change === null ? "text-text" : change >= 0 ? "text-up" : "text-down"
                          }`}
                        >
                          <span className="inline-flex items-center gap-1">
                            {change !== null ? (
                              change >= 0 ? (
                                <ArrowUpRight className="size-3.5" aria-hidden />
                              ) : (
                                <ArrowDownRight className="size-3.5" aria-hidden />
                              )
                            ) : null}
                            {q.lastPrice}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-text-muted">
                          {q.prevClose ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-text-muted">
                          {q.low ?? "—"} – {q.high ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-text-muted">
                          {q.volume ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-text-faint">
                          {new Date(q.asOf).toLocaleTimeString("en-IN")}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-text">
          <ListPlus className="size-4 text-accent" aria-hidden />
          Watchlists
        </h2>
        <WatchlistForm watchlists={watchlists} instruments={instruments} />
      </section>
    </div>
  );
}
