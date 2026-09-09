import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/guard";
import { getMarketStatus } from "@/lib/market-data";
import { getActiveOptionChainProvider } from "@/lib/options";
import { analyseChain } from "@/lib/options/analysis";

/**
 * Option chain plus the derived analytics the UI would otherwise recompute on
 * every render (ATM, PCR, Max Pain, OI-implied support/resistance).
 *
 * Everything in `analysis` is a function of the legs the provider returned.
 * If the provider returns nothing, the analysis is null throughout rather
 * than estimated — a Max Pain computed from an empty chain is a number with
 * no meaning, which is worse than an absent one.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await requireUser();
  if ("response" in gate) return gate.response;

  const params = new URL(request.url).searchParams;
  const underlying = (params.get("underlying") ?? "").trim().toUpperCase();
  if (!underlying) {
    return NextResponse.json({ error: "An underlying is required." }, { status: 400 });
  }

  const expiry = params.get("expiry")?.trim() || undefined;
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    return NextResponse.json(
      { error: "Expiry must be an ISO date (YYYY-MM-DD)." },
      { status: 400 }
    );
  }

  const provider = await getActiveOptionChainProvider();
  const [expiries, snapshot] = await Promise.all([
    provider.getExpiries(underlying),
    provider.getChain(underlying, expiry),
  ]);

  return NextResponse.json({
    configured: provider.isConfigured(),
    provider: provider.name,
    status: getMarketStatus(),
    underlying,
    expiries,
    snapshot,
    analysis: snapshot ? analyseChain(snapshot) : null,
  });
}
