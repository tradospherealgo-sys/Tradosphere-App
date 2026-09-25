import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { getSignalById, getSignalEvents } from "@/lib/signals/reads";
import { CATEGORY_LABELS, CATEGORY_STYLES, isTradeCategory } from "@/lib/signals/categories";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  smc_specialist: "SMC Specialist desk",
  smc_auto_trender: "SMC Auto Trender (algorithmic)",
  tradosphere_ai: "Tradosphere Analysis",
  telegram_channel: "Telegram channel",
  manual: "Desk (entered manually)",
};

const EVENT_LABELS: Record<string, string> = {
  created: "Ingested",
  verified: "Verified by desk",
  rejected: "Rejected by desk",
  released: "Released to clients",
  entry_triggered: "Entry triggered",
  target_hit: "Target hit",
  stop_hit: "Stop loss hit",
  sl_updated: "Stop loss updated",
  target_updated: "Target updated",
  expired: "Expired",
  cancelled: "Cancelled",
};

export default async function SignalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const signal = await getSignalById(id);
  if (!signal) notFound();

  const events = await getSignalEvents(signal.id);
  const source = signal.signal_sources;
  const tradeCategory = isTradeCategory(signal.category);
  const long = signal.direction === "BUY";

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <Link
        href="/signals"
        className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        All signals
      </Link>

      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-text">{signal.symbol}</h1>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs ${CATEGORY_STYLES[signal.category]}`}
          >
            {CATEGORY_LABELS[signal.category]}
          </span>
          {signal.direction !== null && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                long ? "bg-up/15 text-up" : "bg-down/15 text-down"
              }`}
            >
              {long ? "LONG" : "SHORT"}
            </span>
          )}
          {tradeCategory && (
            <span className="text-xs text-text-faint">{signal.instrument_kind}</span>
          )}
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
            {signal.status.replace(/_/g, " ")}
          </span>
        </div>
        <p className="mt-2 text-sm text-text-muted">
          Published by{" "}
          <span className="text-text">
            {source ? SOURCE_LABELS[source.kind] ?? source.name : "an unknown source"}
          </span>
          {source?.is_trusted ? " (trusted source)" : ""} on{" "}
          {new Date(signal.issued_at).toLocaleString("en-IN")}.
          {signal.verification_state === "verified"
            ? " Verified against the source by a Tradosphere admin."
            : ` Verification state: ${signal.verification_state}.`}
        </p>
      </header>

      {tradeCategory ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Level
            label="Entry"
            value={
              signal.entry_price !== null
                ? fmt(signal.entry_price)
                : signal.entry_low !== null && signal.entry_high !== null
                  ? `${fmt(signal.entry_low)} – ${fmt(signal.entry_high)}`
                  : null
            }
          />
          <Level label="Stop loss" value={num(signal.stop_loss)} />
          <Level label="Target 1" value={num(signal.target_1)} />
          <Level label="Target 2" value={num(signal.target_2)} />
          <Level label="Target 3" value={num(signal.target_3)} />
          <Level
            label="Risk : Reward"
            value={signal.risk_reward !== null ? signal.risk_reward.toFixed(2) : null}
          />
          <Level
            label="Confidence"
            value={signal.confidence !== null ? `${signal.confidence}%` : null}
          />
          <Level
            label="Valid until"
            value={signal.expires_at ? new Date(signal.expires_at).toLocaleString("en-IN") : null}
          />
        </section>
      ) : (
        signal.normalized_message && (
          <section className="rounded-2xl border border-border bg-surface p-4 md:p-6">
            <p className="whitespace-pre-line text-sm text-text-muted">
              {signal.normalized_message}
            </p>
          </section>
        )
      )}

      {(signal.rationale || signal.risk_note) && (
        <section className="space-y-4 rounded-2xl border border-border bg-surface p-4 md:p-6">
          {signal.rationale && (
            <div>
              <h2 className="text-sm font-medium text-text">Rationale</h2>
              <p className="mt-1 whitespace-pre-line text-sm text-text-muted">
                {signal.rationale}
              </p>
            </div>
          )}
          {signal.risk_note && (
            <div>
              <h2 className="text-sm font-medium text-text">Risk note</h2>
              <p className="mt-1 whitespace-pre-line text-sm text-warn">{signal.risk_note}</p>
            </div>
          )}
        </section>
      )}

      {tradeCategory && (
        <section>
          <p className="text-sm text-text-faint">
            This signal is {signal.status.replace(/_/g, " ")}.
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-text">
          <History className="size-4 text-accent" aria-hidden />
          Lifecycle
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-text-faint">No lifecycle events recorded yet.</p>
        ) : (
          <ol className="space-y-2">
            {events.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-border bg-surface px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-text">{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
                  <span className="text-xs text-text-faint">
                    {new Date(e.created_at).toLocaleString("en-IN")}
                  </span>
                </div>
                {e.detail && <p className="mt-1 text-xs text-text-muted">{e.detail}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Level({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-text-faint">{label}</p>
      <p className={`mt-1 text-base ${value ? "text-text" : "text-text-faint"}`}>
        {value ?? "not provided"}
      </p>
    </div>
  );
}

function num(n: number | null): string | null {
  return n !== null ? fmt(n) : null;
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
