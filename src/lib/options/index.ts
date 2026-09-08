import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { NoneOptionChainProvider } from "./providers/none";
import { NseUnofficialOptionChainProvider } from "./providers/nse-unofficial";
import { SmcOptionChainProvider } from "./providers/smc";
import type { OptionChainProvider } from "./types";

export type { OptionChainProvider, OptionChainSnapshot, OptionLeg } from "./types";
export { findAtmStrike, classifyMoneyness, calcPcr, calcMaxPain } from "./calc";

const CONFIG_ID = "option_chain_provider";

/**
 * Resolves the active option-chain provider from `integration_configs`
 * (row id 'option_chain_provider'). Same fallback contract as
 * getActiveMarketDataProvider(): always returns a usable provider, falling
 * back to NoneOptionChainProvider (explicit "no data") if nothing is
 * configured/enabled.
 */
export async function getActiveOptionChainProvider(): Promise<OptionChainProvider> {
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
      case "nse_unofficial":
        return new NseUnofficialOptionChainProvider();
      default:
        return new NoneOptionChainProvider();
    }
  } catch {
    return new NoneOptionChainProvider();
  }
}
