import { NextResponse } from "next/server";
import { parseSymbols, requireUser } from "@/lib/api/guard";
import { getActiveMarketDataProvider, getMarketStatus } from "@/lib/market-data";

/**
 * Normalized quotes for the browser. The client never sees which provider
 * served them or what credential was used — only the shape defined in
 * src/lib/market-data/types.ts.
 *
 * A symbol the provider could not resolve is simply absent from `quotes`
 * rather than present with a placeholder price. The client is expected to
 * render an explicit "no data" state for the gap, which is why the response
 * also carries `configured` and `status`: "the market is shut" and "the feed
 * is broken" look identical in the data and must not look identical in the UI.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await requireUser();
  if ("response" in gate) return gate.response;

  const url = new URL(request.url);
  const symbols = parseSymbols(url.searchParams.get("symbols"));

  if (symbols.length === 0) {
    return NextResponse.json({ error: "At least one symbol is required." }, { status: 400 });
  }

  const maxStaleParam = url.searchParams.get("maxStaleMs");
  const maxStaleMs =
    maxStaleParam && Number.isFinite(Number(maxStaleParam))
      ? Math.max(0, Number(maxStaleParam))
      : undefined;

  const provider = await getActiveMarketDataProvider();
  const quotes = await provider.getQuotes(symbols, { maxStaleMs });

  return NextResponse.json({
    configured: provider.isConfigured(),
    provider: provider.name,
    status: getMarketStatus(),
    requested: symbols,
    quotes,
  });
}
