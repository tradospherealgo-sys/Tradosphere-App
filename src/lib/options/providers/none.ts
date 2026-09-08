import type { OptionChainProvider, OptionChainSnapshot, ProviderTestResult } from "../types";

/**
 * Default/disabled option-chain provider. Mirrors
 * src/lib/market-data/providers/none.ts — explicit "no data" everywhere,
 * never a synthesized chain.
 */
export class NoneOptionChainProvider implements OptionChainProvider {
  readonly name = "none";
  readonly label = "Not configured";

  isConfigured(): boolean {
    return false;
  }

  async getExpiries(_underlying: string): Promise<string[]> {
    return [];
  }

  async getChain(_underlying: string, _expiry?: string): Promise<OptionChainSnapshot | null> {
    return null;
  }

  async testConnection(): Promise<ProviderTestResult> {
    return {
      ok: false,
      message: "No option-chain provider is configured. Set one up in Admin → Integrations.",
      testedAt: new Date().toISOString(),
    };
  }
}
