/**
 * The option-chain UI and API deal in short index codes (NIFTY, BANKNIFTY,
 * FINNIFTY, MIDCPNIFTY), but `instruments.symbol` stores the exchange's full
 * index names (NIFTY 50, NIFTY BANK, NIFTY FIN SERVICE, NIFTY MIDCAP 100).
 * Centralizing the mapping here means any option-chain provider's
 * instrument-key lookup can resolve a short code without the UI or API route
 * needing to know the DB's naming.
 */
const UNDERLYING_ALIASES: Record<string, string> = {
  NIFTY: "NIFTY 50",
  BANKNIFTY: "NIFTY BANK",
  FINNIFTY: "NIFTY FIN SERVICE",
  MIDCPNIFTY: "NIFTY MIDCAP 100",
};

export function resolveUnderlyingAlias(symbol: string): string {
  return UNDERLYING_ALIASES[symbol.toUpperCase()] ?? symbol;
}
