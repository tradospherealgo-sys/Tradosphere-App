/**
 * Paper Trading is intentionally not exposed to users yet. The order
 * ticket, order book and history UI below are deliberately not rendered
 * here — the engine they talk to (src/lib/trading, the paper_accounts /
 * orders / positions / trades tables and RPCs) is untouched and stays
 * ready for a dedicated paper-trading component later.
 */
export const dynamic = "force-static";

export default function PaperTradingPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 md:px-10">
      <div className="w-full max-w-md rounded-2xl border border-dashed border-border bg-bg/40 px-6 py-12 text-center">
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
          Coming soon
        </span>
        <p className="mt-4 text-sm font-medium text-text">Paper Trading isn&apos;t available yet</p>
        <p className="mx-auto mt-2 max-w-sm text-xs text-text-faint">
          We&apos;re building a dedicated simulated-trading experience with live
          market fills, position sizing and full order history. It isn&apos;t
          switched on for accounts yet — check back soon.
        </p>
      </div>
    </div>
  );
}
