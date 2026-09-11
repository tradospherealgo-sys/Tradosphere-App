import type { SignalCategory } from "@/types/database";

/**
 * Only these three categories carry a direction/entry/stop-loss — the rest
 * are informational desk content (an IPO note, an education lesson) that a
 * client should still see, just never rendered as if it were a trade call.
 */
export const TRADE_CATEGORIES: readonly SignalCategory[] = ["F&O", "EQUITY", "COMMODITY"];

export function isTradeCategory(category: SignalCategory): boolean {
  return (TRADE_CATEGORIES as SignalCategory[]).includes(category);
}

export const CATEGORY_LABELS: Record<SignalCategory, string> = {
  "F&O": "F&O",
  EQUITY: "Equity",
  COMMODITY: "Commodity",
  IPO: "IPO",
  SIP: "SIP",
  MUTUAL_FUND: "Mutual fund",
  INVESTMENT: "Investment",
  INSURANCE: "Insurance",
  LOAN: "Loan",
  MARKET_UPDATE: "Market update",
  EDUCATION: "Education",
  OTHER: "Other",
};

export const CATEGORY_STYLES: Record<SignalCategory, string> = {
  "F&O": "border-accent/40 text-accent-strong",
  EQUITY: "border-accent/40 text-accent-strong",
  COMMODITY: "border-accent/40 text-accent-strong",
  IPO: "border-warn/40 text-warn",
  SIP: "border-border text-text-muted",
  MUTUAL_FUND: "border-border text-text-muted",
  INVESTMENT: "border-border text-text-muted",
  INSURANCE: "border-border text-text-muted",
  LOAN: "border-border text-text-muted",
  MARKET_UPDATE: "border-border text-text-muted",
  EDUCATION: "border-border text-text-muted",
  OTHER: "border-border text-text-faint",
};

/**
 * Signal-centre filter buckets. Mirrors the client-facing filter set (All /
 * F&O / Equity / Commodity / IPO / Investment / Other) while every card still
 * shows its exact category via CATEGORY_LABELS — the bucket only decides
 * which tab a signal shows up under.
 */
export const CATEGORY_FILTERS = [
  { key: "all", label: "All", categories: null as SignalCategory[] | null },
  { key: "fno", label: "F&O", categories: ["F&O"] },
  { key: "equity", label: "Equity", categories: ["EQUITY"] },
  { key: "commodity", label: "Commodity", categories: ["COMMODITY"] },
  { key: "ipo", label: "IPO", categories: ["IPO"] },
  {
    key: "investment",
    label: "Investment",
    categories: ["INVESTMENT", "SIP", "MUTUAL_FUND", "INSURANCE", "LOAN"],
  },
  { key: "other", label: "Other", categories: ["MARKET_UPDATE", "EDUCATION", "OTHER"] },
] satisfies { key: string; label: string; categories: SignalCategory[] | null }[];

export function matchesFilter(category: SignalCategory, filterKey: string): boolean {
  const filter = CATEGORY_FILTERS.find((f) => f.key === filterKey);
  if (!filter || !filter.categories) return true;
  return (filter.categories as SignalCategory[]).includes(category);
}
