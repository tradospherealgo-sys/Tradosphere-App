import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OptionChainProvider, OptionChainSnapshot, OptionLeg, ProviderTestResult } from "../types";
import { resolveUnderlyingAlias } from "../underlying-aliases";

/**
 * Upstox option-chain connector (official v2 REST API).
 *
 * Verified live against a real Upstox account (2026-09-11):
 *   - GET /v2/option/contract?instrument_key=...           -> all contracts
 *     for the underlying, including their real expiry dates. Used for
 *     getExpiries() instead of a dedicated expiries endpoint (Upstox does
 *     not publish one) — the distinct `expiry` values across contracts are
 *     the real, tradeable expiry list.
 *   - GET /v2/option/chain?instrument_key=...&expiry_date=... -> one row per
 *     strike with nested call_options/put_options, each carrying real
 *     market_data (ltp, oi, volume, bid/ask) AND real option_greeks (iv,
 *     delta, gamma, theta, vega, pop) computed by Upstox itself — this
 *     connector never runs its own pricing model over these, unlike the
 *     client-side Black-Scholes estimate shown when a provider omits Greeks.
 *
 * Shares the same instrument-key resolution and access-token handling as the
 * market-data connector (src/lib/market-data/providers/upstox.ts) — kept
 * duplicated rather than factored into a shared module for this pass to
 * avoid coupling the two provider registries together; both read the same
 * `instruments.provider_token` column and the same env var.
 */

const HOST = "https://api.upstox.com/v2";

type UpstoxOptionConfig = {
  /** Explicit symbol -> instrument_key overrides, e.g. {"NIFTY 50": "NSE_INDEX|Nifty 50"}. */
  instrumentKeys?: Record<string, string>;
};

const instrumentKeyCache = new Map<string, { key: string | null; fetchedAt: number }>();
const INSTRUMENT_CACHE_TTL_MS = 5 * 60 * 1000;

export class UpstoxOptionChainProvider implements OptionChainProvider {
  readonly name = "upstox";
  readonly label = "Upstox";

  private readonly cfg: UpstoxOptionConfig;
  private readonly accessToken: string | null;

  constructor(config: unknown, secretEnvVar: string | null) {
    this.cfg = (config ?? {}) as UpstoxOptionConfig;
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

  private async resolveInstrumentKey(underlying: string): Promise<string | null> {
    const override = this.cfg.instrumentKeys?.[underlying];
    if (override) return override;

    if (underlying.includes("|")) return underlying;

    const lookupSymbol = resolveUnderlyingAlias(underlying);

    const cached = instrumentKeyCache.get(lookupSymbol);
    if (cached && Date.now() - cached.fetchedAt < INSTRUMENT_CACHE_TTL_MS) {
      return cached.key;
    }

    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from("instruments")
        .select("provider_token")
        .ilike("symbol", lookupSymbol)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      const key = data?.provider_token ?? null;
      instrumentKeyCache.set(lookupSymbol, { key, fetchedAt: Date.now() });
      return key;
    } catch {
      return null;
    }
  }

  async getExpiries(underlying: string): Promise<string[]> {
    if (!this.isConfigured()) return [];

    const instrumentKey = await this.resolveInstrumentKey(underlying);
    if (!instrumentKey) return [];

    try {
      const res = await fetch(
        `${HOST}/option/contract?instrument_key=${encodeURIComponent(instrumentKey)}`,
        { headers: this.headers(), cache: "no-store" }
      );
      if (!res.ok) return [];

      const json = (await res.json()) as unknown;
      const rows = isRecord(json) && Array.isArray(json.data) ? json.data : [];
      const dates = rows
        .map((row) => (isRecord(row) && typeof row.expiry === "string" ? row.expiry : null))
        .filter((d): d is string => d !== null);

      return Array.from(new Set(dates)).sort();
    } catch {
      return [];
    }
  }

  async getChain(underlying: string, expiry?: string): Promise<OptionChainSnapshot | null> {
    if (!this.isConfigured()) return null;

    const instrumentKey = await this.resolveInstrumentKey(underlying);
    if (!instrumentKey) return null;

    const resolvedExpiry = expiry ?? (await this.getExpiries(underlying))[0];
    if (!resolvedExpiry) return null;

    try {
      const res = await fetch(
        `${HOST}/option/chain?instrument_key=${encodeURIComponent(instrumentKey)}&expiry_date=${encodeURIComponent(resolvedExpiry)}`,
        { headers: this.headers(), cache: "no-store" }
      );
      if (!res.ok) return null;

      const json = (await res.json()) as unknown;
      const rows = isRecord(json) && Array.isArray(json.data) ? json.data : [];
      if (rows.length === 0) return null;

      let spot: number | null = null;
      const legs: OptionLeg[] = [];

      for (const row of rows) {
        if (!isRecord(row)) continue;
        const strike = toNumber(row.strike_price);
        if (strike === null) continue;

        if (spot === null) spot = toNumber(row.underlying_spot_price);

        const call = isRecord(row.call_options) ? row.call_options : null;
        const put = isRecord(row.put_options) ? row.put_options : null;
        if (call) legs.push(mapLeg(strike, "CE", call));
        if (put) legs.push(mapLeg(strike, "PE", put));
      }

      if (legs.length === 0) return null;

      return {
        underlying: underlying.toUpperCase(),
        expiry: resolvedExpiry,
        spotAtCapture: spot,
        capturedAt: new Date().toISOString(),
        source: this.name,
        legs,
      };
    } catch {
      return null;
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

    // Same rationale as the market-data connector: probe a market-data
    // endpoint, not /v2/user/profile, since that account-level endpoint can
    // be static-IP-restricted independently of whether the token itself is
    // valid for market data.
    try {
      const res = await fetch(
        `${HOST}/market-quote/ltp?instrument_key=${encodeURIComponent("NSE_INDEX|Nifty 50")}`,
        { headers: this.headers(), cache: "no-store" }
      );

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          message:
            "Upstox rejected the access token (401/403). Upstox tokens expire daily at 3:30 AM IST with no refresh token — mint a new one via the OAuth login flow and update the env var.",
          testedAt,
        };
      }
      if (!res.ok) {
        return { ok: false, message: `Upstox responded with HTTP ${res.status}.`, testedAt };
      }

      const expiries = await this.getExpiries("NIFTY 50");
      if (expiries.length === 0) {
        return {
          ok: true,
          message:
            "Authenticated with Upstox, but no expiries could be resolved for NIFTY 50 — map instruments.provider_token or set config.instrumentKeys.",
          testedAt,
        };
      }

      const chain = await this.getChain("NIFTY 50", expiries[0]);
      return {
        ok: true,
        message: chain
          ? `Authenticated — mapped ${chain.legs.length} live legs for NIFTY 50 ${chain.expiry}.`
          : `Authenticated and read ${expiries.length} expiries, but no legs could be mapped for NIFTY 50 ${expiries[0]}.`,
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

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A leg with ltp<=0 and no oi/volume is Upstox's "no data for this strike" shape, not a real zero quote. */
function mapLeg(strike: number, optionType: "CE" | "PE", source: Record<string, unknown>): OptionLeg {
  const market = isRecord(source.market_data) ? source.market_data : {};
  const greeks = isRecord(source.option_greeks) ? source.option_greeks : {};

  return {
    strike,
    optionType,
    ltp: toNumber(market.ltp),
    bid: toNumber(market.bid_price),
    ask: toNumber(market.ask_price),
    volume: toNumber(market.volume),
    oi: toNumber(market.oi),
    changeOi: diffOrNull(toNumber(market.oi), toNumber(market.prev_oi)),
    iv: toNumber(greeks.iv),
    delta: toNumber(greeks.delta),
    gamma: toNumber(greeks.gamma),
    theta: toNumber(greeks.theta),
    vega: toNumber(greeks.vega),
  };
}

function diffOrNull(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

export const __testing = { mapLeg, toNumber, diffOrNull };
