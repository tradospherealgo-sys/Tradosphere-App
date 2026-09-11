import Link from "next/link";
import type { SignalWithSource } from "@/lib/signals/reads";
import { CATEGORY_LABELS, CATEGORY_STYLES, isTradeCategory } from "@/lib/signals/categories";

/**
 * One published call.
 *
 * Every level is rendered only if the source actually supplied it — a
 * missing target shows "not provided" rather than a dash that could be read
 * as a real zero, and R:R appears only when the database's generated column
 * had enough real inputs to compute it.
 *
 * The source and verification badges are not decoration: they are how a user
 * distinguishes a named SMC analyst's call from an algorithmic one from
 * Tradosphere's own combination layer.
 */

const SOURCE_LABELS: Record<string, string> = {
  smc_specialist: "SMC Specialist",
  smc_auto_trender: "SMC Auto Trender",
  tradosphere_ai: "Tradosphere Analysis",
  telegram_channel: "Telegram",
  manual: "Desk (manual)",
};

const STATUS_STYLES: Record<string, string> = {
  active: "border-up/40 text-up",
  triggered: "border-accent/40 text-accent-strong",
  target_hit: "border-up/40 text-up",
  stopped_out: "border-down/40 text-down",
  expired: "border-border text-text-faint",
  cancelled: "border-border text-text-faint",
  pending: "border-warn/40 text-warn",
};

export function SignalCard({ signal }: { signal: SignalWithSource }) {
  const source = signal.signal_sources;
  const tradeCategory = isTradeCategory(signal.category);
  const long = signal.direction === "BUY";
  const entry =
    signal.entry_price !== null
      ? fmt(signal.entry_price)
      : signal.entry_low !== null && signal.entry_high !== null
        ? `${fmt(signal.entry_low)} – ${fmt(signal.entry_high)}`
        : null;

  return (
    <Link
      href={`/signals/${signal.id}`}
      className="block rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-accent"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium text-text">{signal.symbol}</span>
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
        <span className="text-xs text-text-faint">{signal.instrument_kind}</span>
        <span
          className={`ml-auto rounded-full border px-2 py-0.5 text-xs ${
            STATUS_STYLES[signal.status] ?? "border-border text-text-faint"
          }`}
        >
          {signal.status.replace(/_/g, " ")}
        </span>
      </div>

      {tradeCategory ? (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Level label="Entry" value={entry} />
          <Level label="Stop loss" value={signal.stop_loss !== null ? fmt(signal.stop_loss) : null} />
          <Level label="Target 1" value={signal.target_1 !== null ? fmt(signal.target_1) : null} />
          <Level
            label="R:R"
            value={signal.risk_reward !== null ? `${signal.risk_reward.toFixed(2)}` : null}
          />
        </div>
      ) : (
        signal.normalized_message && (
          <p className="mt-3 line-clamp-2 text-sm text-text-muted">{signal.normalized_message}</p>
        )
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-faint">
        <span className="text-text-muted">
          {source ? SOURCE_LABELS[source.kind] ?? source.name : "Unknown source"}
        </span>
        {source?.is_trusted && <span className="text-up">trusted source</span>}
        <span
          className={
            signal.verification_state === "verified" ? "text-accent-strong" : "text-warn"
          }
        >
          {signal.verification_state === "verified"
            ? "verified by Tradosphere"
            : signal.verification_state}
        </span>
        {signal.confidence !== null && <span>confidence {signal.confidence}%</span>}
        <span className="ml-auto">{new Date(signal.issued_at).toLocaleString("en-IN")}</span>
      </div>
    </Link>
  );
}

function Level({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-text-faint">{label}</p>
      <p className={value ? "text-text" : "text-text-faint"}>{value ?? "not provided"}</p>
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
