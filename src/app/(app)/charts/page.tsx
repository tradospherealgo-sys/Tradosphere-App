import { Activity } from "lucide-react";
import { ChartPanel } from "./chart-panel";

export const dynamic = "force-dynamic";

export default async function ChartsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>;
}) {
  const params = await searchParams;
  const symbol = (params.symbol ?? "RELIANCE").toUpperCase();

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text">
          <Activity className="size-5 text-accent" aria-hidden />
          Interactive Charts
        </h1>
        <p className="text-sm text-text-muted">
          Real historical OHLC candles from the active market-data provider.
        </p>
      </header>

      {/* Symbol and interval are owned by the client panel so switching either
          re-fetches over the API instead of re-rendering the whole route. The
          query param only seeds the initial symbol, keeping /charts?symbol=X
          links from elsewhere in the app working. */}
      <ChartPanel initialSymbol={symbol} />
    </div>
  );
}
