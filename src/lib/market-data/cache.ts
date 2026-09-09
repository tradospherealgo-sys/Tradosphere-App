import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { quoteTtlMs } from "./market-hours";
import type {
  Candle,
  CandleInterval,
  MarketDataProvider,
  ProviderTestResult,
  Quote,
  QuoteOptions,
} from "./types";

/**
 * Caching / throttling / retry decorator around any MarketDataProvider.
 *
 * This is a wrapper, not a provider: it owns no vendor knowledge and can
 * never produce a price of its own. Everything it serves came from a real
 * upstream response at a known instant, and every cached entry carries that
 * instant through unchanged in `Quote.asOf`. A cache miss with a failing
 * upstream returns null — it does not fall back to the last value it saw,
 * because silently serving a stale price as if it were current is the same
 * failure mode as inventing one.
 *
 * The one exception is explicit and opt-in: `getQuote(symbol, { maxStaleMs })`
 * lets a caller state how old a price it will tolerate. The paper-trading
 * fill path sets a tight bound; a watchlist tile is happy with a looser one.
 *
 * Three concerns, deliberately in one place because they interact:
 *
 *   Caching    — per-symbol TTL, tightened to seconds while the session is
 *                open and relaxed when it is closed (a closed market's last
 *                traded price cannot change).
 *   Dedup      — concurrent requests for the same symbol share one upstream
 *                call. Without this, a dashboard rendering eight tiles for
 *                the same index fires eight identical requests.
 *   Retry      — one bounded retry with backoff for transient failures only.
 *                A provider that returns "no data" is not retried: that is a
 *                real answer, not an error.
 */

type CacheEntry<T> = { value: T; storedAt: number };

const quoteCache = new Map<string, CacheEntry<Quote>>();
const candleCache = new Map<string, CacheEntry<Candle[]>>();
const inFlight = new Map<string, Promise<unknown>>();

/** Historical candles are immutable once closed; only the forming bar moves. */
const CANDLE_TTL_MS: Record<CandleInterval, number> = {
  "1m": 30_000,
  "5m": 60_000,
  "15m": 120_000,
  "1h": 300_000,
  "1d": 900_000,
};

const MAX_CACHE_ENTRIES = 500;
const RETRY_DELAY_MS = 250;

export class CachedMarketDataProvider implements MarketDataProvider {
  readonly name: string;
  readonly label: string;

  constructor(private readonly inner: MarketDataProvider) {
    this.name = inner.name;
    this.label = inner.label;
  }

  isConfigured(): boolean {
    return this.inner.isConfigured();
  }

  async getQuote(symbol: string, options: QuoteOptions = {}): Promise<Quote | null> {
    if (!this.isConfigured()) return null;

    const key = `${this.name}:${symbol.toUpperCase()}`;
    const cached = quoteCache.get(key);

    if (cached && isQuoteFresh(cached, options)) return cached.value;

    const quote = await dedupe(key, () =>
      withRetry(() => this.inner.getQuote(symbol))
    );
    if (!quote) return null;

    // A provider can legitimately hand back a timestamp older than the
    // caller's bound (a thin scrip that has not traded recently). Honour the
    // caller's requirement rather than the fact that the call succeeded.
    if (options.maxStaleMs !== undefined && quoteAgeMs(quote) > options.maxStaleMs) {
      return null;
    }

    store(quoteCache, key, quote);
    void persistQuote(quote);
    return quote;
  }

  async getQuotes(symbols: string[], options: QuoteOptions = {}): Promise<Quote[]> {
    if (!this.isConfigured() || symbols.length === 0) return [];

    const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
    const hits: Quote[] = [];
    const misses: string[] = [];

    for (const symbol of unique) {
      const cached = quoteCache.get(`${this.name}:${symbol}`);
      if (cached && isQuoteFresh(cached, options)) hits.push(cached.value);
      else misses.push(symbol);
    }

    if (misses.length === 0) return hits;

    // Batch endpoints exist precisely to avoid N round trips, so the misses
    // go to the provider's own batch path rather than a loop of getQuote.
    const fetched = await withRetry(() => this.inner.getQuotes(misses));
    const accepted = (fetched ?? []).filter(
      (q) => options.maxStaleMs === undefined || quoteAgeMs(q) <= options.maxStaleMs
    );

    for (const quote of accepted) {
      store(quoteCache, `${this.name}:${quote.symbol.toUpperCase()}`, quote);
      void persistQuote(quote);
    }

    return [...hits, ...accepted];
  }

  async getHistoricalCandles(
    symbol: string,
    interval: CandleInterval,
    from: Date,
    to: Date
  ): Promise<Candle[]> {
    if (!this.isConfigured()) return [];

    // The window is bucketed by day so that a chart re-rendering with a
    // to-date of "now" still hits the same cache entry second to second.
    const key = [
      this.name,
      symbol.toUpperCase(),
      interval,
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
    ].join(":");

    const cached = candleCache.get(key);
    if (cached && Date.now() - cached.storedAt < CANDLE_TTL_MS[interval]) {
      return cached.value;
    }

    const candles = await dedupe(key, () =>
      withRetry(() => this.inner.getHistoricalCandles(symbol, interval, from, to))
    );
    if (!candles || candles.length === 0) return [];

    store(candleCache, key, candles);
    void persistCandles(symbol, interval, candles, this.name);
    return candles;
  }

  testConnection(): Promise<ProviderTestResult> {
    // Never cached, never retried: an admin pressing "test" wants this
    // attempt's real result, including its failure.
    return this.inner.testConnection();
  }
}

function quoteAgeMs(quote: Quote, now: number = Date.now()): number {
  const asOf = new Date(quote.asOf).getTime();
  return Number.isNaN(asOf) ? Number.POSITIVE_INFINITY : Math.max(0, now - asOf);
}

function isQuoteFresh(entry: CacheEntry<Quote>, options: QuoteOptions): boolean {
  if (Date.now() - entry.storedAt >= quoteTtlMs()) return false;
  if (options.maxStaleMs === undefined) return true;
  return quoteAgeMs(entry.value) <= options.maxStaleMs;
}

/**
 * Collapses concurrent identical requests onto one upstream call. The entry
 * is removed in a `finally` so a rejected call never poisons later attempts.
 */
async function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/**
 * One bounded retry for transient failures. Providers in this codebase
 * signal "no data" by returning null/[] rather than throwing, so a thrown
 * error is exactly the transient case (socket reset, DNS blip) worth
 * retrying — and a null result is a real answer that must not be.
 */
async function withRetry<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      return await run();
    } catch {
      return null;
    }
  }
}

/** Bounded LRU-ish eviction: drop the oldest insertion once over capacity. */
function store<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, storedAt: Date.now() });
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
}

/**
 * Write-through to `market_data_cache`. This table is an observability and
 * history record of what the provider actually returned — it is deliberately
 * NOT a read path for fills, because a row here has no freshness contract.
 * Failures are swallowed: a logging table must never break a page render.
 */
async function persistQuote(quote: Quote): Promise<void> {
  try {
    await createAdminClient()
      .from("market_data_cache")
      .upsert(
        {
          symbol: quote.symbol.toUpperCase(),
          name: quote.name,
          last_price: quote.lastPrice,
          prev_close: quote.prevClose,
          day_open: quote.open,
          day_high: quote.high,
          day_low: quote.low,
          volume: quote.volume,
          as_of: quote.asOf,
          source: quote.source,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "symbol" }
      );
  } catch {
    // Intentionally ignored — see above.
  }
}

async function persistCandles(
  symbol: string,
  interval: CandleInterval,
  candles: Candle[],
  source: string
): Promise<void> {
  try {
    // Only the most recent slice is retained. The full window is already in
    // the in-memory cache for the chart; the table exists so a later session
    // can see what the provider served, not as a second charting source.
    const recent = candles.slice(-200).map((c) => ({
      symbol: symbol.toUpperCase(),
      interval,
      ts: c.ts,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      source,
    }));

    if (recent.length > 0) {
      await createAdminClient()
        .from("ohlc_candles")
        .upsert(recent, { onConflict: "symbol,interval,ts" });
    }
  } catch {
    // Intentionally ignored.
  }
}

/** Test seam — lets unit tests start from a known-empty cache. */
export function __clearMarketDataCaches(): void {
  quoteCache.clear();
  candleCache.clear();
  inFlight.clear();
}
