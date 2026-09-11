import Link from "next/link";
import { getLiveSignals, getSignalHistory } from "@/lib/signals/reads";
import { hasEntitlement } from "@/lib/subscriptions/reads";
import { SignalCard } from "@/components/signal-card";
import { EmptyState } from "@/components/empty-state";
import { EntitlementGate } from "@/components/entitlement-gate";
import { CATEGORY_FILTERS, matchesFilter } from "@/lib/signals/categories";

export const dynamic = "force-dynamic";

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  // Checked before fetching so an unsubscribed user gets a plan prompt rather
  // than an empty list — RLS would return nothing either way, but silence
  // reads as "no signals today", which is a different and misleading claim.
  if (!(await hasEntitlement("signals"))) {
    return (
      <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
        <header>
          <h1 className="text-xl font-semibold text-text">Signals</h1>
        </header>
        <EntitlementGate entitlement="signals" feature="Signals">
          {null}
        </EntitlementGate>
      </div>
    );
  }

  const { category } = await searchParams;
  const activeFilter = CATEGORY_FILTERS.some((f) => f.key === category) ? category! : "all";

  const [live, history] = await Promise.all([getLiveSignals(), getSignalHistory(60)]);
  const liveIds = new Set(live.map((s) => s.id));
  const closed = history.filter((s) => !liveIds.has(s.id));

  const liveFiltered = live.filter((s) => matchesFilter(s.category, activeFilter));
  const closedFiltered = closed.filter((s) => matchesFilter(s.category, activeFilter));

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">Signals</h1>
        <p className="mt-1 text-sm text-text-muted">
          Calls from SMC specialists, the SMC Auto Trender and Tradosphere&rsquo;s
          own analysis layer, shown only after a desk admin has verified them
          against the source. Every level here was published by that source —
          nothing is estimated or filled in. Signals are for paper trading only.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {CATEGORY_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/signals" : `/signals?category=${f.key}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              activeFilter === f.key
                ? "border-accent bg-accent/15 text-accent-strong"
                : "border-border text-text-muted hover:border-accent/40"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text">Live</h2>
        {liveFiltered.length === 0 ? (
          <EmptyState
            title="No live signals"
            body="Verified calls that are still active or triggered appear here. If a source has published nothing today, this stays empty rather than showing a placeholder."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {liveFiltered.map((s) => (
              <SignalCard key={s.id} signal={s} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text">Closed</h2>
        {closedFiltered.length === 0 ? (
          <EmptyState title="No closed signals yet" />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {closedFiltered.map((s) => (
              <SignalCard key={s.id} signal={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
