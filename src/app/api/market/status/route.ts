import { NextResponse } from "next/server";
import { getMarketStatus } from "@/lib/market-data";

/**
 * NSE session status. Pure calendar arithmetic — it touches no provider and
 * leaks nothing, so it is deliberately unauthenticated: the login screen and
 * marketing surfaces can show "Market closed" without a session.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getMarketStatus());
}
