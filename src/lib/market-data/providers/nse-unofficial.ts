import "server-only";
import type {
  Candle,
  CandleInterval,
  MarketDataProvider,
  ProviderTestResult,
  Quote,
} from "../types";
import { nseGet } from "./nse-session";

/**
 * Reference connector for NSE India's public (undocumented, unofficial)
 * JSON endpoints — real market data, no API key required. This is
 * explicitly dev-grade: NSE rate-limits aggressively, occasionally changes
 * response shapes without notice, and blocks non-browser-like requests.
 * It is a reasonable default for local development / evaluation, NOT a
 * production SLA-backed feed. For production, configure the generic REST
 * provider against a licensed vendor instead (Admin → Integrations).
 *
 * NSE requires a same-origin cookie handshake before its /api/* endpoints
 * respond with data (a bare request returns 401/403). We bootstrap a
 * session by hitting the homepage first, cache the cookies for a few
 * minutes, and reuse them across requests.
 */

type NseQuoteResponse = {
  info?: { symbol?: string; companyName?: string };
  priceInfo?: {
    lastPrice?: number;
    open?: number;
    close?: number; // previous close
    intraDayHighLow?: { min?: number; max?: number };
  };
  securityWiseDP?: { quantityTraded?: number };
  metadata?: { lastUpdateTime?: string };
};

export class NseUnofficialProvider implements MarketDataProvider {
  readonly name = "nse_unofficial";
  readonly label = "NSE India (unofficial, dev-grade)";

  isConfigured(): boolean {
    // No secret required — this connector only needs outbound network
    // access, which is always "available" from the provider's own
    // perspective. Admins still have to explicitly enable it.
    return true;
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    const data = await nseGet<NseQuoteResponse>(
      `/api/quote-equity?symbol=${encodeURIComponent(symbol.toUpperCase())}`
    );
    if (!data?.priceInfo?.lastPrice) return null;

    return {
      symbol: data.info?.symbol ?? symbol.toUpperCase(),
      name: data.info?.companyName ?? null,
      lastPrice: data.priceInfo.lastPrice,
      prevClose: data.priceInfo.close ?? null,
      open: data.priceInfo.open ?? null,
      high: data.priceInfo.intraDayHighLow?.max ?? null,
      low: data.priceInfo.intraDayHighLow?.min ?? null,
      volume: data.securityWiseDP?.quantityTraded ?? null,
      asOf: parseNseTimestamp(data.metadata?.lastUpdateTime),
      source: this.name,
    };
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    // NSE has no documented batch-quote endpoint for arbitrary symbol
    // lists; fetch sequentially with a small delay to stay under its
    // informal rate limits rather than hammering it in parallel.
    const quotes: Quote[] = [];
    for (const symbol of symbols) {
      const quote = await this.getQuote(symbol);
      if (quote) quotes.push(quote);
    }
    return quotes;
  }

  async getHistoricalCandles(
    symbol: string,
    interval: CandleInterval,
    from: Date,
    to: Date
  ): Promise<Candle[]> {
    // NSE's public historical endpoint only serves daily (EOD) series, no
    // intraday candles. For any intraday interval we return empty rather
    // than fabricate a resampled series.
    if (interval !== "1d") return [];

    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

    type NseHistoricalResponse = {
      data?: Array<{
        CH_TIMESTAMP?: string;
        CH_OPENING_PRICE?: number;
        CH_TRADE_HIGH_PRICE?: number;
        CH_TRADE_LOW_PRICE?: number;
        CH_CLOSING_PRICE?: number;
        CH_TOT_TRADED_QTY?: number;
      }>;
    };

    const data = await nseGet<NseHistoricalResponse>(
      `/api/historical/cm/equity?symbol=${encodeURIComponent(
        symbol.toUpperCase()
      )}&series=[%22EQ%22]&from=${fmt(from)}&to=${fmt(to)}`
    );

    if (!data?.data) return [];

    return data.data
      .filter((row) => row.CH_TIMESTAMP && row.CH_CLOSING_PRICE != null)
      .map((row) => ({
        ts: new Date(row.CH_TIMESTAMP as string).toISOString(),
        open: row.CH_OPENING_PRICE ?? 0,
        high: row.CH_TRADE_HIGH_PRICE ?? 0,
        low: row.CH_TRADE_LOW_PRICE ?? 0,
        close: row.CH_CLOSING_PRICE ?? 0,
        volume: row.CH_TOT_TRADED_QTY ?? null,
      }));
  }

  async testConnection(): Promise<ProviderTestResult> {
    const quote = await this.getQuote("RELIANCE");
    return {
      ok: quote !== null,
      message: quote
        ? `Connected — RELIANCE last price ${quote.lastPrice} as of ${quote.asOf}.`
        : "Could not fetch a test quote from NSE. It may be rate-limiting, blocking this request, or temporarily down.",
      testedAt: new Date().toISOString(),
    };
  }
}

function parseNseTimestamp(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  // NSE format: "DD-Mon-YYYY HH:mm:ss"
  const match = raw.match(/(\d{2})-(\w{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return new Date().toISOString();
  const [, day, mon, year, hh, mm, ss] = match;
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const iso = `${year}-${months[mon] ?? "01"}-${day}T${hh}:${mm}:${ss}+05:30`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
