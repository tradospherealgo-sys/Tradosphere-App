import "server-only";
import {
  SmcSession,
  readPath,
  toIsoDateOrNull,
  toNumber,
  type PathMap,
  type SmcBaseConfig,
} from "@/lib/market-data/providers/smc-session";
import type {
  OptionChainProvider,
  OptionChainSnapshot,
  OptionLeg,
  ProviderTestResult,
} from "../types";

/**
 * SMC Global option-chain connector.
 *
 * Shares the session/token cache with the SMC market-data connector (see
 * src/lib/market-data/providers/smc-session.ts), so enabling both
 * integrations opens one upstream session, not two.
 *
 * Like the market-data adapter this is mapping-driven: the endpoint paths
 * and the JSON field names live in `integration_configs.config` for the
 * `option_chain_provider` row, editable in Admin -> Integrations. SMC
 * publishes the concrete chain schema only to onboarded partners, so the
 * defaults below follow the common Indian broker shape and are expected to
 * be adjusted once against the real response.
 *
 * Two response layouts are supported without code changes:
 *   - "flat":   one row per (strike, option type), distinguished by a field
 *               whose value is CE/PE.
 *   - "paired": one row per strike carrying nested `CE` and `PE` objects.
 *
 * Any leg that cannot be mapped to a real strike is dropped. A chain with no
 * mappable legs returns null so the UI shows an explicit "no data" state
 * rather than an empty grid that reads as "no open interest".
 */

type SmcOptionConfig = SmcBaseConfig & {
  expiriesPath?: string;
  chainPath?: string;
  /** "flat" (default) or "paired". */
  layout?: "flat" | "paired";
  expiryFields?: PathMap;
  chainFields?: PathMap;
  legFields?: PathMap;
};

const DEFAULT_EXPIRY_FIELDS: PathMap = {
  rows: "data",
  /** Blank means the row itself is the date string. */
  value: "",
};

const DEFAULT_CHAIN_FIELDS: PathMap = {
  rows: "data",
  spot: "data.underlyingValue",
  /** Row-level fields, read relative to each row. */
  strike: "strikePrice",
  optionType: "optionType",
  ce: "CE",
  pe: "PE",
};

const DEFAULT_LEG_FIELDS: PathMap = {
  ltp: "ltp",
  bid: "bidPrice",
  ask: "askPrice",
  volume: "tradeVolume",
  oi: "openInterest",
  changeOi: "changeinOpenInterest",
  iv: "impliedVolatility",
  delta: "delta",
  gamma: "gamma",
  theta: "theta",
  vega: "vega",
};

export class SmcOptionChainProvider implements OptionChainProvider {
  readonly name = "smc";
  readonly label = "SMC Global";

  private readonly cfg: SmcOptionConfig;
  private readonly session: SmcSession;

  constructor(config: unknown, secretEnvVar: string | null) {
    this.cfg = (config ?? {}) as SmcOptionConfig;
    this.session = new SmcSession(
      { ...this.cfg, exchange: this.cfg.exchange ?? "NFO" },
      secretEnvVar
    );
  }

  isConfigured(): boolean {
    return this.session.isConfigured();
  }

  private path(template: string, underlying: string, expiry?: string): string {
    return template
      .replace("{underlying}", encodeURIComponent(underlying.toUpperCase()))
      .replace("{expiry}", encodeURIComponent(expiry ?? ""))
      .replace("{exchange}", encodeURIComponent(this.cfg.exchange ?? "NFO"));
  }

  async getExpiries(underlying: string): Promise<string[]> {
    if (!this.isConfigured()) return [];

    const json = await this.session.authedFetch(
      this.path(this.cfg.expiriesPath ?? "/rest/market/option-expiries?symbol={underlying}", underlying)
    );
    if (!json) return [];

    const fields = { ...DEFAULT_EXPIRY_FIELDS, ...(this.cfg.expiryFields ?? {}) };
    const rows = readPath(json, fields.rows);
    if (!Array.isArray(rows)) return [];

    const dates = rows
      .map((row) => toIsoDateOrNull(fields.value ? readPath(row, fields.value) : row))
      .filter((d): d is string => d !== null);

    return Array.from(new Set(dates)).sort();
  }

  async getChain(underlying: string, expiry?: string): Promise<OptionChainSnapshot | null> {
    if (!this.isConfigured()) return null;

    const resolvedExpiry = expiry ?? (await this.getExpiries(underlying))[0];
    if (!resolvedExpiry) return null;

    const json = await this.session.authedFetch(
      this.path(
        this.cfg.chainPath ?? "/rest/market/option-chain?symbol={underlying}&expiry={expiry}",
        underlying,
        resolvedExpiry
      )
    );
    if (!json) return null;

    const fields = { ...DEFAULT_CHAIN_FIELDS, ...(this.cfg.chainFields ?? {}) };
    const legFields = { ...DEFAULT_LEG_FIELDS, ...(this.cfg.legFields ?? {}) };

    const rows = readPath(json, fields.rows);
    if (!Array.isArray(rows)) return null;

    const legs: OptionLeg[] = [];
    for (const row of rows) {
      const strike = toNumber(readPath(row, fields.strike));
      if (strike === null) continue;

      if (this.cfg.layout === "paired") {
        const ce = readPath(row, fields.ce);
        const pe = readPath(row, fields.pe);
        if (ce) legs.push(mapLeg(strike, "CE", ce, legFields));
        if (pe) legs.push(mapLeg(strike, "PE", pe, legFields));
        continue;
      }

      const rawType = readPath(row, fields.optionType);
      const optionType = normalizeOptionType(rawType);
      if (!optionType) continue;
      legs.push(mapLeg(strike, optionType, row, legFields));
    }

    if (legs.length === 0) return null;

    return {
      underlying: underlying.toUpperCase(),
      expiry: resolvedExpiry,
      spotAtCapture: toNumber(readPath(json, fields.spot)),
      capturedAt: new Date().toISOString(),
      source: this.name,
      legs,
    };
  }

  async testConnection(): Promise<ProviderTestResult> {
    const testedAt = new Date().toISOString();
    const missing = this.session.missing();

    if (missing) {
      return {
        ok: false,
        message: `SMC option-chain connector is incomplete. Missing: ${missing}. Set the env vars server-side and the base URL in this panel.`,
        testedAt,
      };
    }

    if (!(await this.session.login())) {
      return {
        ok: false,
        message:
          "Reached the configured base URL but the login did not return a session token. Check the client code, secret, and loginPath against your SMC API documentation.",
        testedAt,
      };
    }

    const expiries = await this.getExpiries("NIFTY");
    if (expiries.length === 0) {
      return {
        ok: false,
        message:
          "Authenticated successfully, but no expiry dates could be mapped for NIFTY. Check expiriesPath and expiryFields against your SMC API response shape.",
        testedAt,
      };
    }

    const chain = await this.getChain("NIFTY", expiries[0]);
    return chain
      ? {
          ok: true,
          message: `Authenticated and mapped ${chain.legs.length} live legs for NIFTY ${chain.expiry}.`,
          testedAt,
        }
      : {
          ok: false,
          message: `Authenticated and read ${expiries.length} expiries, but no legs could be mapped for NIFTY ${expiries[0]}. Check chainPath, layout, chainFields and legFields against your SMC API response shape.`,
          testedAt,
        };
  }
}

function normalizeOptionType(value: unknown): "CE" | "PE" | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  if (upper === "CE" || upper === "CALL" || upper === "C") return "CE";
  if (upper === "PE" || upper === "PUT" || upper === "P") return "PE";
  return null;
}

function mapLeg(
  strike: number,
  optionType: "CE" | "PE",
  source: unknown,
  fields: PathMap
): OptionLeg {
  const read = (key: string) => toNumber(readPath(source, fields[key]));
  return {
    strike,
    optionType,
    ltp: read("ltp"),
    bid: read("bid"),
    ask: read("ask"),
    volume: read("volume"),
    oi: read("oi"),
    changeOi: read("changeOi"),
    iv: read("iv"),
    // Greeks are passed through only if the provider supplies them. They are
    // never back-computed from a pricing model, which would present an
    // estimate as vendor data.
    delta: read("delta"),
    gamma: read("gamma"),
    theta: read("theta"),
    vega: read("vega"),
  };
}

export const __testing = { normalizeOptionType, mapLeg };
