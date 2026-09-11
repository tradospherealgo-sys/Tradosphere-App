import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/guard";
import { getMarketStatus } from "@/lib/market-data";
import { getActiveOptionChainProvider } from "@/lib/options";
import { analyseChain } from "@/lib/options/analysis";
import { hasEntitlement } from "@/lib/subscriptions/reads";

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

  // RLS on option_chain_snapshots would eventually block an unentitled user,
  // but as a plain data query (not a table read) it would just come back
  // empty rather than explaining why — check the entitlement explicitly so
  // the response is an honest 403, matching the page-level gate.
  if (!(await hasEntitlement("option_chain"))) {
    return NextResponse.json(
      { error: "Your plan does not include option chain access." },
      { status: 403 }
    );
  }

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
