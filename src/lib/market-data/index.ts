import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { NoneProvider } from "./providers/none";
import { NseUnofficialProvider } from "./providers/nse-unofficial";
import { GenericRestProvider } from "./providers/generic-rest";
import { SmcProvider } from "./providers/smc";
import type { MarketDataProvider } from "./types";

export type { MarketDataProvider, Quote, Candle, CandleInterval } from "./types";

const CONFIG_ID = "market_data_provider";

/**
 * Resolves the currently active market-data provider from
 * `integration_configs`. Server-side only (reads the service-role client
 * and, for the generic REST provider, a server env var holding the secret
 * key). Always returns a usable MarketDataProvider — falls back to
 * NoneProvider (which returns "no data" from every method) if nothing is
 * configured/enabled or the row can't be read, rather than throwing and
 * breaking pages that just want to render a quote.
 */
export async function getActiveMarketDataProvider(): Promise<MarketDataProvider> {
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
      default:
        return new NoneProvider();
    }
  } catch {
    return new NoneProvider();
  }
}
