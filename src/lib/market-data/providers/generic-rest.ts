import "server-only";
import type {
  Candle,
  CandleInterval,
  MarketDataProvider,
  ProviderTestResult,
  Quote,
} from "../types";

/**
 * Generic REST connector for any licensed/production market-data vendor
 * (e.g. a broker API, a paid data vendor). The admin configures:
 *   - `config.baseUrl`   — non-secret, stored in integration_configs.config
 *   - `secretEnvVar`     — the NAME of a server env var holding the API
 *                          key/token; the key value itself is never stored
 *                          in the database or sent to the browser
 *
 * Expected upstream contract (adapt via config.paths if a vendor differs):
 *   GET {baseUrl}/quote?symbol=SYMBOL
 *     -> { symbol, name?, lastPrice, prevClose?, open?, high?, low?, volume?, asOf }
 *   GET {baseUrl}/candles?symbol=SYMBOL&interval=1d&from=ISO&to=ISO
 *     -> { candles: [{ ts, open, high, low, close, volume? }, ...] }
 * Auth: `Authorization: Bearer {apiKey}` header.
 *
 * This class deliberately does not ship a specific vendor SDK — wiring a
 * real production feed means pointing `baseUrl` at that vendor's REST API
 * and, if its response shape differs, adjusting the two mapping functions
 * below (mapQuote / mapCandle). If the upstream call fails or the key is
 * missing, every method returns null/empty — it never invents a price.
 */

type GenericRestConfig = {
  baseUrl: string;
};

export class GenericRestProvider implements MarketDataProvider {
  readonly name = "generic_rest";
  readonly label = "Generic REST provider";

  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;

  constructor(config: unknown, secretEnvVar: string | null) {
    const parsed = (config ?? {}) as Partial<GenericRestConfig>;
    this.baseUrl = typeof parsed.baseUrl === "string" && parsed.baseUrl.length > 0 ? parsed.baseUrl : null;
    this.apiKey = secretEnvVar ? process.env[secretEnvVar] ?? null : null;
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    if (!this.isConfigured()) return null;
    try {
      const res = await fetch(
        `${this.baseUrl}/quote?symbol=${encodeURIComponent(symbol)}`,
        { headers: this.headers(), cache: "no-store" }
      );
      if (!res.ok) return null;
      const json = await res.json();
      return mapQuote(json, this.name);
    } catch {
      return null;
    }
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const results = await Promise.all(symbols.map((s) => this.getQuote(s)));
    return results.filter((q): q is Quote => q !== null);
  }

  async getHistoricalCandles(
    symbol: string,
    interval: CandleInterval,
    from: Date,
    to: Date
  ): Promise<Candle[]> {
    if (!this.isConfigured()) return [];
    try {
      const res = await fetch(
        `${this.baseUrl}/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}` +
          `&from=${from.toISOString()}&to=${to.toISOString()}`,
        { headers: this.headers(), cache: "no-store" }
      );
      if (!res.ok) return [];
      const json = await res.json();
      const rows = Array.isArray(json?.candles) ? json.candles : [];
      return rows.map(mapCandle).filter((c: Candle | null): c is Candle => c !== null);
    } catch {
      return [];
    }
  }

  async testConnection(): Promise<ProviderTestResult> {
    if (!this.baseUrl) {
      return {
        ok: false,
        message: "No base URL configured for the generic REST provider.",
        testedAt: new Date().toISOString(),
      };
    }
    if (!this.apiKey) {
      return {
        ok: false,
        message: "Configured secret_env_var is not set in the server environment.",
        testedAt: new Date().toISOString(),
      };
    }
    try {
      const res = await fetch(`${this.baseUrl}/quote?symbol=TEST`, {
        headers: this.headers(),
        cache: "no-store",
      });
      return {
        ok: res.ok,
        message: res.ok
          ? "Connected to the configured endpoint successfully."
          : `Endpoint responded with HTTP ${res.status}.`,
        testedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Connection failed.",
        testedAt: new Date().toISOString(),
      };
    }
  }
}

function mapQuote(json: unknown, source: string): Quote | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  if (typeof j.symbol !== "string" || typeof j.lastPrice !== "number") return null;

  return {
    symbol: j.symbol,
    name: typeof j.name === "string" ? j.name : null,
    lastPrice: j.lastPrice,
    prevClose: typeof j.prevClose === "number" ? j.prevClose : null,
    open: typeof j.open === "number" ? j.open : null,
    high: typeof j.high === "number" ? j.high : null,
    low: typeof j.low === "number" ? j.low : null,
    volume: typeof j.volume === "number" ? j.volume : null,
    asOf: typeof j.asOf === "string" ? j.asOf : new Date().toISOString(),
    source,
  };
}

function mapCandle(row: unknown): Candle | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (
    typeof r.ts !== "string" ||
    typeof r.open !== "number" ||
    typeof r.high !== "number" ||
    typeof r.low !== "number" ||
    typeof r.close !== "number"
  ) {
    return null;
  }
  return {
    ts: r.ts,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: typeof r.volume === "number" ? r.volume : null,
  };
}

export const __testing = { mapQuote, mapCandle };
