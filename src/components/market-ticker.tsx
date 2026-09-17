"use client";

import { ArrowDownRight, ArrowUpRight, Radio } from "lucide-react";
import { useLiveQuotes } from "@/lib/market-data/use-live-quotes";

/**
 * Persistent compact index strip shown across every authenticated page.
 *
 * Deliberately narrow to two indices (NIFTY 50, NIFTY BANK) — these are the
 * only symbols the Upstox provider currently resolves live end-to-end. Any
 * other index would either be blank (not fed) or, worse, silently show a
 * stale historical-only value next to two genuinely live ones. Widening this
 * list is a provider-mapping change, not a UI change.
 */
export function MarketTicker({ symbols }: { symbols: string[] }) {
  const { quotes, status, configured, connected } = useLiveQuotes(symbols);

  if (symbols.length === 0) return null;

  if (!configured) {
    return (
      <div className="border-b border-border bg-surface px-4 py-2 text-xs text-text-faint md:px-10">
        Live market ticker unavailable — no market-data provider configured.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 overflow-x-auto border-b border-border bg-surface px-4 py-2 md:px-10">
      <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-faint">
        <Radio
          className={`size-3 ${status?.isOpen ? "text-up" : "text-text-faint"}`}
          aria-hidden
        />
        {status ? status.isOpen ? "Live" : "Closed" : connected ? "…" : "Connecting"}
      </div>
      <div className="flex items-center gap-5">
        {symbols.map((symbol) => (
          <TickerItem key={symbol} symbol={symbol} quote={quotes[symbol.toUpperCase()]} />
        ))}
      </div>
    </div>
  );
}

function TickerItem({
  symbol,
  quote,
}: {
  symbol: string;
  quote?: { lastPrice: number; prevClose: number | null };
}) {
  if (!quote) {
    return (
      <div className="flex shrink-0 items-baseline gap-1.5 text-xs">
        <span className="font-medium text-text">{symbol}</span>
        <span className="text-text-faint">—</span>
      </div>
    );
  }

  const change = quote.prevClose !== null ? quote.lastPrice - quote.prevClose : null;
  const changePct = change !== null && quote.prevClose ? (change / quote.prevClose) * 100 : null;
  const up = change !== null && change >= 0;

  return (
    <div className="flex shrink-0 items-baseline gap-1.5 text-xs">
      <span className="font-medium text-text">{symbol}</span>
      <span className="tabular-nums text-text">{quote.lastPrice.toFixed(2)}</span>
      {change !== null ? (
        <span
          className={`flex items-center gap-0.5 tabular-nums ${up ? "text-up" : "text-down"}`}
        >
          {up ? (
            <ArrowUpRight className="size-3" aria-hidden />
          ) : (
            <ArrowDownRight className="size-3" aria-hidden />
          )}
          {changePct !== null ? `${changePct.toFixed(2)}%` : `${change.toFixed(2)}`}
        </span>
      ) : null}
    </div>
  );
}
