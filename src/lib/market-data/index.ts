import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { NoneProvider } from "./providers/none";
import { NseUnofficialProvider } from "./providers/nse-unofficial";
import { GenericRestProvider } from "./providers/generic-rest";
import { SmcProvider } from "./providers/smc";
import { TestFixtureProvider, testFixtureEnabled } from "./providers/test-fixture";
import { CachedMarketDataProvider } from "./cache";
import type { MarketDataProvider } from "./types";

export type {
  MarketDataProvider,
  Quote,
  Candle,
  CandleInterval,
  QuoteOptions,
} from "./types";
export { getMarketStatus, quoteTtlMs } from "./market-hours";
export type { MarketStatus, MarketPhase } from "./market-hours";

const CONFIG_ID = "market_data_provider";

/**
 * Longest a quote may be when it is used as a paper-trading fill price.
 * Past this bound the order is refused rather than filled against a price
 * that no longer describes the market. A stale fill is a fabricated fill
 * with a plausible provenance, which is the harder kind to notice.
 */
export const FILL_MAX_STALE_MS = 60_000;

/**
 * Resolves the currently active market-data provider from
 * `integration_configs`, wrapped in the caching/retry decorator.
 *
 * Server-side only (reads the service-role client and, for keyed providers,
 * server env vars holding the secret). Always returns a usable
 * MarketDataProvider — falls back to NoneProvider (which returns "no data"
 * from every method) if nothing is configured/enabled or the row can't be
 * read, rather than throwing and breaking pages that just want a quote.
 *
 * The decorator is applied here, once, so no call site can accidentally
 * bypass the cache and hammer a rate-limited upstream.
 */
export async function getActiveMarketDataProvider(): Promise<MarketDataProvider> {
  return new CachedMarketDataProvider(await resolveProvider());
}

/**
 * The raw, undecorated provider. Only the admin "test connection" path
 * should use this — everything else wants the cached one.
 */
export async function getRawMarketDataProvider(): Promise<MarketDataProvider> {
  return resolveProvider();
}

async function resolveProvider(): Promise<MarketDataProvider> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("integration_configs")
      .select("*")
      .eq("id", CONFIG_ID)
      .single();

    if (!data || !data.is_enabled) {
      return new NoneProvider();
    }

    switch (data.provider) {
      case "smc":
        return new SmcProvider(data.config, data.secret_env_var);
      case "nse_unofficial":
        return new NseUnofficialProvider();
      case "generic_rest":
        return new GenericRestProvider(data.config, data.secret_env_var);
      // Selecting the fixture is not enough on its own — the server also has
      // to have been started with the env var. Without it this falls through
      // to NoneProvider, so a fixture row that somehow reached a production
      // database yields "not configured" rather than invented prices.
      case "test_fixture":
        return testFixtureEnabled() ? new TestFixtureProvider() : new NoneProvider();
      default:
        return new NoneProvider();
    }
  } catch {
    return new NoneProvider();
  }
}
