/**
 * Provider-agnostic market-data contract. Every concrete provider
 * (src/lib/market-data/providers/*) implements this interface. The rest of
 * the app talks only to this interface via getActiveMarketDataProvider(),
 * never to a specific vendor SDK — swapping providers is an admin config
 * change (integration_configs row), not a code change.
 *
 * Hard rule for every implementation: if real data isn't available (not
 * configured, upstream error, symbol not found), return `null` / an empty
 * array / `configured: false`. NEVER invent, interpolate, or randomly
 * generate a price. Callers must render an explicit "no data" state.
 */

export type Quote = {
  symbol: string;
  name: string | null;
  lastPrice: number;
  prevClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  /** ISO timestamp the quote was captured/observed at the source. */
  asOf: string;
  /** Provider name that produced this quote, e.g. "nse_unofficial". */
  source: string;
};

export type Candle = {
  ts: string; // ISO timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "1d";

export type ProviderTestResult = {
  ok: boolean;
  message: string;
  testedAt: string;
};

/**
 * Freshness contract a caller can impose on a quote. Concrete providers
 * ignore it (they always go upstream); the caching decorator enforces it.
 * Supplying `maxStaleMs` is a correctness statement — "a price older than
 * this is unusable for what I'm about to do". The order-fill path sets a
 * tight bound; a watchlist tile sets none.
 */
export type QuoteOptions = {
  maxStaleMs?: number;
};

export interface MarketDataProvider {
  /** Machine name — must match the `provider` column in integration_configs. */
  readonly name: string;
  /** Human label for admin UI. */
  readonly label: string;
  /** False for the built-in "none" provider, or if required secrets/config are missing. */
  isConfigured(): boolean;
  /** Single real-time (or best-effort delayed) quote, or null if unavailable. */
  getQuote(symbol: string, options?: QuoteOptions): Promise<Quote | null>;
  /** Batch quotes. Implementations should skip symbols they can't resolve, not fabricate them. */
  getQuotes(symbols: string[], options?: QuoteOptions): Promise<Quote[]>;
  /** Historical OHLC candles for charting. Empty array if unavailable. */
  getHistoricalCandles(
    symbol: string,
    interval: CandleInterval,
    from: Date,
    to: Date
  ): Promise<Candle[]>;
  /** Admin "test connection" action — verifies config/credentials against the live upstream. */
  testConnection(): Promise<ProviderTestResult>;
}
