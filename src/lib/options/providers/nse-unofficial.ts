import "server-only";
import { nseGet } from "@/lib/market-data/providers/nse-session";
import type { OptionChainProvider, OptionChainSnapshot, OptionLeg, ProviderTestResult } from "../types";

/**
 * Reference connector for NSE India's public (unofficial) option-chain
 * endpoints — real strikes/OI/IV/Greeks, no API key required. Same
 * dev-grade caveats as the market-data NSE connector: aggressive rate
 * limiting, undocumented shape, not a production SLA feed. Shares the
 * cookie-handshake session with src/lib/market-data/providers/nse-session.ts.
 *
 * Index underlyings (NIFTY, BANKNIFTY, FINNIFTY, ...) and equity
 * underlyings use different NSE endpoints, so we route based on a known
 * index-symbol set.
 */

const INDEX_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]);

type NseOptionLeg = {
  openInterest?: number;
  changeinOpenInterest?: number;
  impliedVolatility?: number;
  lastPrice?: number;
  bidprice?: number;
  askPrice?: number;
  totalTradedVolume?: number;
};

type NseOptionChainResponse = {
  records?: {
    expiryDates?: string[];
    underlyingValue?: number;
    data?: Array<{
      strikePrice?: number;
      expiryDate?: string;
      CE?: NseOptionLeg;
      PE?: NseOptionLeg;
    }>;
  };
};

function endpointFor(underlying: string): string {
  const symbol = encodeURIComponent(underlying.toUpperCase());
  return INDEX_SYMBOLS.has(underlying.toUpperCase())
    ? `/api/option-chain-indices?symbol=${symbol}`
    : `/api/option-chain-equities?symbol=${symbol}`;
}

export class NseUnofficialOptionChainProvider implements OptionChainProvider {
  readonly name = "nse_unofficial";
  readonly label = "NSE India (unofficial, dev-grade)";

  isConfigured(): boolean {
    return true;
  }

  async getExpiries(underlying: string): Promise<string[]> {
    const data = await nseGet<NseOptionChainResponse>(endpointFor(underlying));
    return data?.records?.expiryDates ?? [];
  }

  async getChain(underlying: string, expiry?: string): Promise<OptionChainSnapshot | null> {
    const data = await nseGet<NseOptionChainResponse>(endpointFor(underlying));
    const records = data?.records;
    if (!records?.data || records.data.length === 0) return null;

    const resolvedExpiry = expiry ?? records.expiryDates?.[0];
    if (!resolvedExpiry) return null;

    const legs: OptionLeg[] = [];
    for (const row of records.data) {
      if (!row.strikePrice || row.expiryDate !== resolvedExpiry) continue;
      if (row.CE) legs.push(mapLeg(row.strikePrice, "CE", row.CE));
      if (row.PE) legs.push(mapLeg(row.strikePrice, "PE", row.PE));
    }

    if (legs.length === 0) return null;

    return {
      underlying: underlying.toUpperCase(),
      expiry: normalizeExpiryToIso(resolvedExpiry),
      spotAtCapture: records.underlyingValue ?? null,
      capturedAt: new Date().toISOString(),
      source: this.name,
      legs,
    };
  }

  async testConnection(): Promise<ProviderTestResult> {
    const chain = await this.getChain("NIFTY");
    return {
      ok: chain !== null,
      message: chain
        ? `Connected — NIFTY chain returned ${chain.legs.length} legs for expiry ${chain.expiry}.`
        : "Could not fetch a test option chain from NSE. It may be rate-limiting, blocking this request, or temporarily down.",
      testedAt: new Date().toISOString(),
    };
  }
}

function mapLeg(strike: number, optionType: "CE" | "PE", leg: NseOptionLeg): OptionLeg {
  return {
    strike,
    optionType,
    ltp: leg.lastPrice ?? null,
    bid: leg.bidprice ?? null,
    ask: leg.askPrice ?? null,
    volume: leg.totalTradedVolume ?? null,
    oi: leg.openInterest ?? null,
    changeOi: leg.changeinOpenInterest ?? null,
    iv: leg.impliedVolatility ?? null,
    // NSE's public option-chain endpoint doesn't expose Greeks beyond IV.
    // Left null rather than computed client-side from a pricing model,
    // since that would blur "real provider data" with a derived estimate.
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
  };
}

function normalizeExpiryToIso(nseDate: string): string {
  // NSE format: "DD-Mon-YYYY" (e.g. "25-Jul-2024")
  const match = nseDate.match(/(\d{2})-(\w{3})-(\d{4})/);
  if (!match) return nseDate;
  const [, day, mon, year] = match;
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  return `${year}-${months[mon] ?? "01"}-${day}`;
}
