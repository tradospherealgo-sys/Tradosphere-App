import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { NoneOptionChainProvider } from "./providers/none";
import { NseUnofficialOptionChainProvider } from "./providers/nse-unofficial";
import { SmcOptionChainProvider } from "./providers/smc";
import { UpstoxOptionChainProvider } from "./providers/upstox";
import { CachedOptionChainProvider } from "./cache";
import type { OptionChainProvider } from "./types";

export type { OptionChainProvider, OptionChainSnapshot, OptionLeg } from "./types";
export { findAtmStrike, classifyMoneyness, calcPcr, calcMaxPain } from "./calc";

const CONFIG_ID = "option_chain_provider";

/**
 * Resolves the active option-chain provider from `integration_configs`
 * (row id 'option_chain_provider'), wrapped in the caching/retry/breaker
 * decorator. Same fallback contract as getActiveMarketDataProvider():
 * always returns a usable provider, falling back to NoneOptionChainProvider
 * (explicit "no data") if nothing is configured/enabled.
 *
 * The decorator is applied here, once, so no call site can accidentally
 * bypass the cache and hammer a rate-limited upstream on every 15s refresh.
 */
export async function getActiveOptionChainProvider(): Promise<OptionChainProvider> {
  return new CachedOptionChainProvider(await resolveProvider());
}

async function resolveProvider(): Promise<OptionChainProvider> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("integration_configs")
      .select("*")
      .eq("id", CONFIG_ID)
      .single();

    if (!data || !data.is_enabled) {
      return new NoneOptionChainProvider();
    }

    switch (data.provider) {
      case "smc":
        return new SmcOptionChainProvider(data.config, data.secret_env_var);
      case "upstox":
        return new UpstoxOptionChainProvider(data.config, data.secret_env_var);
      case "nse_unofficial":
        return new NseUnofficialOptionChainProvider();
      default:
        return new NoneOptionChainProvider();
    }
  } catch {
    return new NoneOptionChainProvider();
  }
}
