import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getUnreadNotificationCount, getTradableInstruments } from "@/lib/app-data/reads";
import { AppShell } from "@/components/app-shell";

// Every page under this group depends on the signed-in user's session and
// their own private data (paper account, positions, orders, ...) — none of
// it is safe or meaningful to statically prerender.
export const dynamic = "force-dynamic";

// The persistent header ticker is intentionally limited to the two indices
// the Upstox provider actually resolves live end-to-end today (confirmed via
// Admin -> System Health). Any other index either has no live feed or only
// historical candles, so listing it here would silently mislead the user.
const TICKER_INDEX_NAMES = ["NIFTY 50", "NIFTY BANK"];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getCurrentUser();
  if (!user) redirect("/login");

  const [unreadCount, instruments] = await Promise.all([
    getUnreadNotificationCount(),
    getTradableInstruments(),
  ]);

  const tickerSymbols = instruments
    .filter((i) => i.is_index && TICKER_INDEX_NAMES.includes(i.symbol.toUpperCase()))
    .map((i) => i.symbol);

  return (
    <AppShell
      user={{ email: user.email }}
      role={profile?.role ?? "user"}
      isAdmin={profile?.role === "admin" && !!profile?.is_active}
      unreadCount={unreadCount}
      tickerSymbols={tickerSymbols}
    >
      {children}
    </AppShell>
  );
}
