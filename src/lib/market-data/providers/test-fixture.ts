import type {
  Candle,
  CandleInterval,
  MarketDataProvider,
  ProviderTestResult,
  Quote,
} from "../types";

/**
 * Deterministic prices for automated tests. NOT A MARKET DATA SOURCE.
 *
 * The end-to-end order lifecycle — place, fill, open a position, close it,
 * book a P&L — cannot be exercised at all without a quote to fill against,
 * and no real provider is reachable from CI. This supplies that quote from a
 * fixed table the test itself writes, so the assertions are about the trading
 * engine rather than about whatever the market happened to be doing.
 *
 * It is deliberately awkward to switch on. Two independent things must both
 * be true: an admin has to have selected `test_fixture` in
 * `integration_configs`, AND the server has to have been started with
 * MARKET_DATA_TEST_FIXTURE set. A production deployment does neither, and
 * selecting the provider without the env var yields NoneProvider — the same
 * honest "not configured" state as having no provider at all — rather than
 * silently serving invented prices to real users.
 *
 * The env var holds the price table as JSON, e.g. {"RELIANCE":1400.5}. There
 * is no default table and no generated/derived price: a symbol the test did
 * not name returns null, exactly as an unknown symbol does upstream.
 */
export const TEST_FIXTURE_ENV_VAR = "MARKET_DATA_TEST_FIXTURE";

export function testFixtureEnabled(): boolean {
  return Boolean(process.env[TEST_FIXTURE_ENV_VAR]);
}

export class TestFixtureProvider implements MarketDataProvider {
  readonly name = "test_fixture";
  readonly label = "Test fixture (non-production)";

  private readonly prices: Record<string, number>;

  constructor() {
    this.prices = parsePrices(process.env[TEST_FIXTURE_ENV_VAR]);
  }

  isConfigured(): boolean {
    return Object.keys(this.prices).length > 0;
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    const key = symbol.trim().toUpperCase();
    const price = this.prices[key];
    if (price === undefined) return null;

    return {
      symbol: key,
      name: key,
      lastPrice: price,
      prevClose: price,
      open: price,
      high: price,
      low: price,
      volume: null,
      // Always "now", so freshness checks behave as they would against a
      // live feed instead of tripping the staleness guard on every call.
      asOf: new Date().toISOString(),
      source: this.name,
    };
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const quotes = await Promise.all(symbols.map((s) => this.getQuote(s)));
    return quotes.filter((q): q is Quote => q !== null);
  }

  /**
   * No candles. Charting against a single flat price would render a
   * straight line that looks like a broken feed, and inventing a shape is
   * exactly what this codebase refuses to do.
   */
  async getHistoricalCandles(
    _symbol: string,
    _interval: CandleInterval,
    _from: Date,
    _to: Date
  ): Promise<Candle[]> {
    return [];
  }

  async testConnection(): Promise<ProviderTestResult> {
    const symbols = Object.keys(this.prices);
    return {
      ok: symbols.length > 0,
      message: symbols.length
        ? `Test fixture active for ${symbols.length} symbol(s): ${symbols.join(", ")}. This is not market data.`
        : `${TEST_FIXTURE_ENV_VAR} is set but holds no usable prices.`,
      testedAt: new Date().toISOString(),
    };
  }
}

function parsePrices(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [symbol, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        out[symbol.trim().toUpperCase()] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}
