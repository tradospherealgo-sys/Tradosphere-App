import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Candle,
  CandleInterval,
  MarketDataProvider,
  ProviderTestResult,
  Quote,
} from "../types";

/**
 * Upstox market-data connector (official v3 REST API).
 *
 * Unlike the SMC connector, Upstox's API is public, versioned and stable, so
 * this adapter talks to its documented shape directly rather than through a
 * configurable field-mapping layer:
 *   - Quotes:            GET /v3/market-quote/ohlc?instrument_key=...&interval=1d
 *   - Historical candles: GET /v3/historical-candle/{key}/{unit}/{interval}/{to}/{from}
 *   - Connectivity check: GET /v2/user/profile (profile/auth stayed on v2)
 * All three require `Authorization: Bearer {access_token}`.
 *
 * Upstox access tokens are NOT long-lived and there is no refresh token: a
 * token is valid only until 3:30 AM IST the following day, after which a
 * human must complete the OAuth authorize/login dance again to mint a new
 * one (see UPSTOX_ACCESS_TOKEN in .env.example). This connector cannot paper
 * over that — when the token expires every call here starts returning null,
 * exactly like a missing credential, and the admin "test connection" panel
 * will say so.
 *
 * Upstox identifies instruments by `instrument_key`
 * (e.g. "NSE_EQ|INE002A01018"), not by trading symbol, so a symbol must be
 * resolved before any upstream call. Resolution order:
 *   1. `config.instrumentKeys[symbol]` — explicit admin override
 *   2. the symbol itself, if it already looks like an instrument_key
 *      (contains "|")
 *   3. `instruments.provider_token` for that symbol, looked up from the
 *      instrument registry (migration 0010) an admin has synced
 * A symbol that resolves to nothing yields `null` — never a fabricated
 * quote — and instructs the caller (via testConnection / logs) that it needs
 * mapping.
 */

const AUTH_HOST = "https://api.upstox.com/v2";
const DATA_HOST = "https://api.upstox.com/v3";

type UpstoxConfig = {
  /** Explicit symbol -> instrument_key overrides, e.g. {"NIFTY 50": "NSE_INDEX|Nifty 50"}. */
  instrumentKeys?: Record<string, string>;
};

const INTERVAL_MAP: Record<CandleInterval, { unit: string; interval: string }> = {
  "1m": { unit: "minutes", interval: "1" },
  "5m": { unit: "minutes", interval: "5" },
  "15m": { unit: "minutes", interval: "15" },
  "1h": { unit: "hours", interval: "1" },
  "1d": { unit: "days", interval: "1" },
};

/** Symbol -> instrument_key results rarely change; avoid a DB round trip per quote. */
const instrumentKeyCache = new Map<string, { key: string | null; fetchedAt: number }>();
const INSTRUMENT_CACHE_TTL_MS = 5 * 60 * 1000;

export class UpstoxProvider implements MarketDataProvider {
  readonly name = "upstox";
  readonly label = "Upstox";

  private readonly cfg: UpstoxConfig;
  private readonly accessToken: string | null;

  constructor(config: unknown, secretEnvVar: string | null) {
    this.cfg = (config ?? {}) as UpstoxConfig;
    const envVar = secretEnvVar?.trim() || "UPSTOX_ACCESS_TOKEN";
    this.accessToken = process.env[envVar] ?? null;
  }

  isConfigured(): boolean {
    return Boolean(this.accessToken);
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this.accessToken}`,
    };
  }

  private async resolveInstrumentKey(symbol: string): Promise<string | null> {
    const override = this.cfg.instrumentKeys?.[symbol];
    if (override) return override;

    if (symbol.includes("|")) return symbol;

    const cached = instrumentKeyCache.get(symbol);
    if (cached && Date.now() - cached.fetchedAt < INSTRUMENT_CACHE_TTL_MS) {
      return cached.key;
    }

    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from("instruments")
        .select("provider_token")
        .ilike("symbol", symbol)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      const key = data?.provider_token ?? null;
      instrumentKeyCache.set(symbol, { key, fetchedAt: Date.now() });
      return key;
    } catch {
      return null;
    }
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    if (!this.isConfigured()) return null;

    const instrumentKey = await this.resolveInstrumentKey(symbol);
    if (!instrumentKey) return null;

    try {
      const res = await fetch(
        `${DATA_HOST}/market-quote/ohlc?instrument_key=${encodeURIComponent(instrumentKey)}&interval=1d`,
        { headers: this.headers(), cache: "no-store" }
      );
      if (!res.ok) return null;

      const json = (await res.json()) as unknown;
      return mapOhlcResponse(json, instrumentKey, symbol, this.name);
    } catch {
      return null;
    }
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    if (!this.isConfigured() || symbols.length === 0) return [];

    const resolved = await Promise.all(
      symbols.map(async (symbol) => ({ symbol, key: await this.resolveInstrumentKey(symbol) }))
    );
    const mappable = resolved.filter((r): r is { symbol: string; key: string } => r.key !== null);
    if (mappable.length === 0) return [];

    try {
      const keys = mappable.map((r) => r.key).join(",");
      const res = await fetch(
        `${DATA_HOST}/market-quote/ohlc?instrument_key=${encodeURIComponent(keys)}&interval=1d`,
        { headers: this.headers(), cache: "no-store" }
      );
      if (!res.ok) return [];

      const json = (await res.json()) as unknown;
      const data = isRecord(json) && isRecord(json.data) ? json.data : {};

      return mappable
        .map(({ symbol, key }) => {
          const entry = data[key] ?? Object.values(data).find(
            (v) => isRecord(v) && v.instrument_token === key
          );
          return entry ? mapOhlcEntry(entry, symbol, this.name) : null;
        })
        .filter((q): q is Quote => q !== null);
    } catch {
      return [];
    }
  }

  async getHistoricalCandles(
    symbol: string,
    interval: CandleInterval,
    from: Date,
    to: Date
  ): Promise<Candle[]> {
    if (!this.isConfigured()) return [];

    const instrumentKey = await this.resolveInstrumentKey(symbol);
    if (!instrumentKey) return [];

    const { unit, interval: intervalValue } = INTERVAL_MAP[interval];
    const toDate = to.toISOString().slice(0, 10);
    const fromDate = from.toISOString().slice(0, 10);

    try {
      const res = await fetch(
        `${DATA_HOST}/historical-candle/${encodeURIComponent(instrumentKey)}/${unit}/${intervalValue}/${toDate}/${fromDate}`,
        { headers: this.headers(), cache: "no-store" }
      );
      if (!res.ok) return [];

      const json = (await res.json()) as unknown;
      const rows =
        isRecord(json) && isRecord(json.data) && Array.isArray(json.data.candles)
          ? json.data.candles
          : [];

      return rows.map(mapCandleRow).filter((c): c is Candle => c !== null);
    } catch {
      return [];
    }
  }

  async testConnection(): Promise<ProviderTestResult> {
    const testedAt = new Date().toISOString();

    if (!this.accessToken) {
      return {
        ok: false,
        message:
          "No Upstox access token configured. Set the server env var this row's secret_env_var names (default UPSTOX_ACCESS_TOKEN) to a token minted via the Upstox OAuth login flow.",
        testedAt,
      };
    }

    // Deliberately does NOT probe /v2/user/profile: live testing against a
    // real Upstox account (2026-09-11) confirmed that endpoint returns
    // UDAPI1221 ("permitted only from the static IP configured in your
    // account") on some accounts even with a perfectly valid token, while the
    // market-quote endpoints this connector actually depends on returned real
    // data from the same token/request with no IP restriction. Probing
    // /user/profile would report a working token as "failed" for any account
    // with that account-level restriction enabled — a false negative on the
    // one thing this button exists to check. NSE_INDEX|Nifty 50 is a
    // constant published in Upstox's own instrument master, not a guess.
    try {
      const res = await fetch(
        `${AUTH_HOST}/market-quote/ltp?instrument_key=${encodeURIComponent("NSE_INDEX|Nifty 50")}`,
        { headers: this.headers(), cache: "no-store" }
      );

      if (res.status === 401 || res.status === 403) {
        const body = (await res.json().catch(() => null)) as unknown;
        const upstreamMessage = extractUpstoxError(body);
        return {
          ok: false,
          message: upstreamMessage
            ? `Upstox rejected the request (${res.status}): ${upstreamMessage}`
            : "Upstox rejected the access token (401/403). Upstox tokens expire daily at 3:30 AM IST with no refresh token — mint a new one via the OAuth login flow and update the env var.",
          testedAt,
        };
      }
      if (!res.ok) {
        return { ok: false, message: `Upstox responded with HTTP ${res.status}.`, testedAt };
      }

      const json = (await res.json()) as unknown;
      const quote =
        isRecord(json) && isRecord(json.data) ? Object.values(json.data)[0] : null;
      const lastPrice =
        isRecord(quote) && typeof quote.last_price === "number" ? quote.last_price : null;

      return {
        ok: true,
        message:
          lastPrice !== null
            ? `Authenticated — live NIFTY 50 LTP ${lastPrice}. Other symbols still require instrument-key mapping via the instrument registry or config.instrumentKeys.`
            : "Authenticated, but the market-quote response shape was unexpected. Check Upstox API status.",
        testedAt,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Connection to Upstox failed.",
        testedAt,
      };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Upstox error shape: { status: "error", errors: [{ message, error_code }] }. */
function extractUpstoxError(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.errors) || body.errors.length === 0) return null;
  const first = body.errors[0];
  return isRecord(first) && typeof first.message === "string" ? first.message : null;
}

/** `interval=1d` OHLC response, single-instrument shape: { status, data: { [key]: entry } }. */
function mapOhlcResponse(
  json: unknown,
  instrumentKey: string,
  symbol: string,
  source: string
): Quote | null {
  if (!isRecord(json) || !isRecord(json.data)) return null;
  const entry = json.data[instrumentKey] ?? Object.values(json.data)[0];
  return entry ? mapOhlcEntry(entry, symbol, source) : null;
}

function mapOhlcEntry(entry: unknown, symbol: string, source: string): Quote | null {
  if (!isRecord(entry)) return null;

  const lastPrice = toNumber(entry.last_price);
  // A quote with no last-traded price is not a quote: the order path must
  // refuse to fill rather than fill at a fabricated zero.
  if (lastPrice === null || lastPrice <= 0) return null;

  const liveOhlc = isRecord(entry.live_ohlc) ? entry.live_ohlc : null;
  const prevOhlc = isRecord(entry.prev_ohlc) ? entry.prev_ohlc : null;

  return {
    symbol: symbol.toUpperCase(),
    name: null,
    lastPrice,
    prevClose: toNumber(prevOhlc?.close),
    open: toNumber(liveOhlc?.open),
    high: toNumber(liveOhlc?.high),
    low: toNumber(liveOhlc?.low),
    volume: toNumber(liveOhlc?.volume),
    asOf: toIsoFromEpochMs(liveOhlc?.ts) ?? new Date().toISOString(),
    source,
  };
}

/** `[iso_ts, open, high, low, close, volume, oi]`. */
function mapCandleRow(row: unknown): Candle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const [ts, open, high, low, close, volume] = row;

  const o = toNumber(open);
  const h = toNumber(high);
  const l = toNumber(low);
  const c = toNumber(close);
  if (typeof ts !== "string" || o === null || h === null || l === null || c === null) {
    return null;
  }

  const parsed = new Date(ts);
  return {
    ts: Number.isNaN(parsed.getTime()) ? ts : parsed.toISOString(),
    open: o,
    high: h,
    low: l,
    close: c,
    volume: toNumber(volume),
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toIsoFromEpochMs(value: unknown): string | null {
  const ms = toNumber(value);
  if (ms === null) return null;
  const parsed = new Date(ms);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export const __testing = { mapOhlcEntry, mapCandleRow, toNumber, toIsoFromEpochMs };
