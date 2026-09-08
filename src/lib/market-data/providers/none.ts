import type {
  Candle,
  CandleInterval,
  MarketDataProvider,
  ProviderTestResult,
  Quote,
} from "../types";

/**
 * Default/disabled provider. Used whenever `integration_configs` has no
 * enabled market-data provider — which is the out-of-the-box state for a
 * fresh deployment. Every method explicitly returns "no data" rather than
 * fabricating anything, so the UI can render a clear "market data not
 * configured" state instead of showing fake numbers.
 */
export class NoneProvider implements MarketDataProvider {
  readonly name = "none";
  readonly label = "Not configured";

  isConfigured(): boolean {
    return false;
  }

  async getQuote(_symbol: string): Promise<Quote | null> {
    return null;
  }

  async getQuotes(_symbols: string[]): Promise<Quote[]> {
    return [];
  }

  async getHistoricalCandles(
    _symbol: string,
    _interval: CandleInterval,
    _from: Date,
    _to: Date
  ): Promise<Candle[]> {
    return [];
  }

  async testConnection(): Promise<ProviderTestResult> {
    return {
      ok: false,
      message: "No market-data provider is configured. Set one up in Admin → Integrations.",
      testedAt: new Date().toISOString(),
    };
  }
}
