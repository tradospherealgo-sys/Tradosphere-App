import { getActiveMarketDataProvider } from "@/lib/market-data";
import { getMyWatchlists } from "@/lib/app-data/reads";
import { EmptyState } from "@/components/empty-state";
import { WatchlistForm } from "./watchlist-form";

export default async function MarketsPage() {
  const [provider, watchlists] = await Promise.all([
    getActiveMarketDataProvider(),
    getMyWatchlists(),
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
        <h1 className="text-xl font-semibold text-text">Live Market Overview</h1>
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
      ) : symbols.length === 0 ? (
        <EmptyState
          title="Your watchlist is empty"
          body="Add symbols below to start tracking live quotes."
        />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-text-faint">
              <th className="pb-2 font-normal">Symbol</th>
              <th className="pb-2 font-normal">LTP</th>
              <th className="pb-2 font-normal">Prev close</th>
              <th className="pb-2 font-normal">Day range</th>
              <th className="pb-2 font-normal">Volume</th>
              <th className="pb-2 font-normal">As of</th>
            </tr>
          </thead>
          <tbody>
            {quotes.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-text-faint">
                  No live quotes returned for these symbols right now.
                </td>
              </tr>
            ) : (
              quotes.map((q) => {
                const change =
                  q.prevClose !== null ? q.lastPrice - q.prevClose : null;
                return (
                  <tr key={q.symbol} className="border-t border-border">
                    <td className="py-2 text-text">{q.symbol}</td>
                    <td
                      className={`py-2 ${
                        change === null ? "text-text" : change >= 0 ? "text-up" : "text-down"
                      }`}
                    >
                      {q.lastPrice}
                    </td>
                    <td className="py-2 text-text-muted">{q.prevClose ?? "—"}</td>
                    <td className="py-2 text-text-muted">
                      {q.low ?? "—"} – {q.high ?? "—"}
                    </td>
                    <td className="py-2 text-text-muted">{q.volume ?? "—"}</td>
                    <td className="py-2 text-text-faint">
                      {new Date(q.asOf).toLocaleTimeString("en-IN")}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      )}

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-4 text-sm font-medium text-text">Watchlists</h2>
        <WatchlistForm watchlists={watchlists} />
      </section>
    </div>
  );
}
