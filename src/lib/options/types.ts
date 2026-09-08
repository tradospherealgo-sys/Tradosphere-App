/**
 * Provider-agnostic option-chain contract, mirroring the market-data
 * abstraction (src/lib/market-data/types.ts). Same hard rule applies: if
 * real data isn't available, return an empty chain / null — NEVER
 * synthesize strikes, LTPs, OI, or Greeks.
 */

export type OptionLeg = {
  strike: number;
  optionType: "CE" | "PE";
  ltp: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  oi: number | null;
  changeOi: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
};

export type OptionChainSnapshot = {
  underlying: string;
  expiry: string; // ISO date, YYYY-MM-DD
  spotAtCapture: number | null;
  capturedAt: string; // ISO timestamp
  source: string;
  legs: OptionLeg[];
};

export type ProviderTestResult = {
  ok: boolean;
  message: string;
  testedAt: string;
};

export interface OptionChainProvider {
  readonly name: string;
  readonly label: string;
  isConfigured(): boolean;
  /** Available expiry dates (ISO YYYY-MM-DD) for an underlying, or [] if unavailable. */
  getExpiries(underlying: string): Promise<string[]>;
  /** Full chain for one underlying + expiry, or null if unavailable. */
  getChain(underlying: string, expiry?: string): Promise<OptionChainSnapshot | null>;
  testConnection(): Promise<ProviderTestResult>;
}
