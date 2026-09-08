import "server-only";
import type {
  Candle,
  CandleInterval,
  MarketDataProvider,
  ProviderTestResult,
  Quote,
} from "../types";
import {
  SmcSession,
  formatBrokerDate,
  readPath,
  toIsoOrNow,
  toNumber,
  toStringOrNull,
  type PathMap,
  type SmcBaseConfig,
} from "./smc-session";

/**
 * SMC Global market-data connector.
 *
 * SMC's trading API belongs to the same family as the other Indian broker
 * APIs (SmartAPI-style): a session login exchanges an API key plus client
 * credentials for a short-lived JWT, and subsequent market-data calls carry
 * that JWT. The exact host, paths and JSON field names differ between
 * vendors and between API versions, so this adapter is *mapping-driven*
 * rather than hard-coded: everything vendor-specific lives in the
 * `integration_configs.config` JSON an admin edits in Admin -> Integrations,
 * and the code below only knows how to call an endpoint and read a value out
 * of a response by path. Session handling lives in ./smc-session.
 *
 * That means pointing this at a live SMC account is a configuration task,
 * not a code change — which matters because the API contract is behind
 * SMC's partner onboarding and cannot be verified from here.
 *
 * Every method returns null / [] when the upstream is unreachable, the
 * credentials are missing, or the response cannot be mapped. It never
 * substitutes a cached, interpolated or invented price.
 */

type SmcConfig = SmcBaseConfig & {
  quotePath?: string;
  candlePath?: string;
  /** Dotted paths into the JSON response, e.g. "data.ltp". */
  quoteFields?: PathMap;
  candleFields?: PathMap;
  /** Provider-specific interval codes, e.g. { "5m": "FIVE_MINUTE" }. */
  intervalMap?: Record<string, string>;
};

const DEFAULT_QUOTE_FIELDS: PathMap = {
  symbol: "data.tradingsymbol",
  name: "data.name",
  lastPrice: "data.ltp",
  prevClose: "data.close",
  open: "data.open",
  high: "data.high",
  low: "data.low",
  volume: "data.tradeVolume",
  asOf: "data.exchFeedTime",
};

const DEFAULT_CANDLE_FIELDS: PathMap = {
  rows: "data",
  ts: "0",
  open: "1",
  high: "2",
  low: "3",
  close: "4",
  volume: "5",
};

const DEFAULT_INTERVALS: Record<CandleInterval, string> = {
  "1m": "ONE_MINUTE",
  "5m": "FIVE_MINUTE",
  "15m": "FIFTEEN_MINUTE",
  "1h": "ONE_HOUR",
  "1d": "ONE_DAY",
};

export class SmcProvider implements MarketDataProvider {
  readonly name = "smc";
  readonly label = "SMC Global";

  private readonly cfg: SmcConfig;
  private readonly session: SmcSession;

  constructor(config: unknown, secretEnvVar: string | null) {
    this.cfg = (config ?? {}) as SmcConfig;
    this.session = new SmcSession(this.cfg, secretEnvVar);
  }

  isConfigured(): boolean {
    return this.session.isConfigured();
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    if (!this.isConfigured()) return null;

    const exchange = this.cfg.exchange ?? "NSE";
    const path = (this.cfg.quotePath ?? "/rest/market/quote")
      .replace("{symbol}", encodeURIComponent(symbol))
      .replace("{exchange}", encodeURIComponent(exchange));

    const json = await this.session.authedFetch(path);
    if (!json) return null;

    const fields = { ...DEFAULT_QUOTE_FIELDS, ...(this.cfg.quoteFields ?? {}) };
    const lastPrice = toNumber(readPath(json, fields.lastPrice));

    // A quote with no last-traded price is not a quote. Returning null here is
    // what makes the order path refuse to fill rather than fill at zero.
    if (lastPrice === null || lastPrice <= 0) return null;

    return {
      symbol: toStringOrNull(readPath(json, fields.symbol)) ?? symbol.toUpperCase(),
      name: toStringOrNull(readPath(json, fields.name)),
      lastPrice,
      prevClose: toNumber(readPath(json, fields.prevClose)),
      open: toNumber(readPath(json, fields.open)),
      high: toNumber(readPath(json, fields.high)),
      low: toNumber(readPath(json, fields.low)),
      volume: toNumber(readPath(json, fields.volume)),
      asOf: toIsoOrNow(readPath(json, fields.asOf)),
      source: this.name,
    };
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

    const intervalCode =
      this.cfg.intervalMap?.[interval] ?? DEFAULT_INTERVALS[interval];
    const exchange = this.cfg.exchange ?? "NSE";

    const json = await this.session.authedFetch(
      this.cfg.candlePath ?? "/rest/market/candles",
      {
        method: "POST",
        body: JSON.stringify({
          exchange,
          symboltoken: symbol,
          tradingsymbol: symbol,
          interval: intervalCode,
          fromdate: formatBrokerDate(from),
          todate: formatBrokerDate(to),
        }),
      }
    );
    if (!json) return [];

    const fields = { ...DEFAULT_CANDLE_FIELDS, ...(this.cfg.candleFields ?? {}) };
    const rows = readPath(json, fields.rows);
    if (!Array.isArray(rows)) return [];

    return rows
      .map((row) => mapCandle(row, fields))
      .filter((c): c is Candle => c !== null);
  }

  async testConnection(): Promise<ProviderTestResult> {
    const testedAt = new Date().toISOString();
    const missing = this.session.missing();

    if (missing) {
      return {
        ok: false,
        message: `SMC connector is incomplete. Missing: ${missing}. Set the env vars server-side and the base URL in this panel.`,
        testedAt,
      };
    }

    const token = await this.session.login();
    if (!token) {
      return {
        ok: false,
        message:
          "Reached the configured base URL but the login did not return a session token. Check the client code, secret, and the loginPath in this panel against your SMC API documentation.",
        testedAt,
      };
    }

    // A successful login proves credentials; a successful quote proves the
    // field mapping. Report them separately so a mapping error is not
    // misread as an auth failure.
    const probe = this.cfg.exchange === "NFO" ? "NIFTY" : "RELIANCE";
    const quote = await this.getQuote(probe);

    return quote
      ? {
          ok: true,
          message: `Authenticated and resolved a live quote for ${quote.symbol} at ${quote.lastPrice}.`,
          testedAt,
        }
      : {
          ok: false,
          message: `Authenticated successfully, but no quote could be mapped for ${probe}. Check quotePath and quoteFields against your SMC API response shape.`,
          testedAt,
        };
  }
}

function mapCandle(row: unknown, fields: PathMap): Candle | null {
  const ts = readPath(row, fields.ts);
  const open = toNumber(readPath(row, fields.open));
  const high = toNumber(readPath(row, fields.high));
  const low = toNumber(readPath(row, fields.low));
  const close = toNumber(readPath(row, fields.close));

  if (open === null || high === null || low === null || close === null) return null;

  return {
    ts: toIsoOrNow(ts),
    open,
    high,
    low,
    close,
    volume: toNumber(readPath(row, fields.volume)),
  };
}

export const __testing = { readPath, toNumber, toIsoOrNow, mapCandle, formatBrokerDate };
