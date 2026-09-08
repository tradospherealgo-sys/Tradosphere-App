import Link from "next/link";
import {
  getAllSignals,
  getAllSignalSources,
  getSignalReviewQueue,
  getTelegramInbox,
} from "@/lib/signals/admin-reads";
import { EmptyState } from "@/components/empty-state";
import { LifecycleControls, ReviewControls } from "./review-controls";
import { SignalComposer } from "./signal-composer";
import { SourceManager } from "./source-manager";

export const dynamic = "force-dynamic";

export default async function AdminSignalsPage() {
  const [queue, all, sources, inbox] = await Promise.all([
    getSignalReviewQueue(),
    getAllSignals(60),
    getAllSignalSources(),
    getTelegramInbox(40),
  ]);

  const released = all.filter(
    (s) => s.verification_state === "verified" && s.status !== "pending"
  );

  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">Signal Desk</h1>
        <p className="mt-1 text-sm text-text-muted">
          Nothing reaches a client dashboard until it is verified here.
          Verifying a signal releases it to every subscriber and sends a
          broadcast notification in the same transaction.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text">
          Awaiting review {queue.length > 0 ? `(${queue.length})` : ""}
        </h2>
        {queue.length === 0 ? (
          <EmptyState
            title="Nothing awaiting review"
            body="Ingested and manually entered signals land here before release."
          />
        ) : (
          <div className="space-y-3">
            {queue.map((s) => (
              <div key={s.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-text">{s.symbol}</span>
                  <span className={s.direction === "BUY" ? "text-xs text-up" : "text-xs text-down"}>
                    {s.direction === "BUY" ? "LONG" : "SHORT"}
                  </span>
                  <span className="text-xs text-text-faint">{s.instrument_kind}</span>
                  <span className="ml-auto text-xs text-text-faint">
                    {s.signal_sources?.name ?? "unknown source"} ·{" "}
                    {new Date(s.issued_at).toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
                  <span>Entry {level(s.entry_price ?? s.entry_low)}</span>
                  <span>SL {level(s.stop_loss)}</span>
                  <span>T1 {level(s.target_1)}</span>
                  <span>R:R {s.risk_reward !== null ? s.risk_reward.toFixed(2) : "n/a"}</span>
                </div>
                {s.rationale && <p className="mt-2 text-sm text-text-muted">{s.rationale}</p>}
                {s.raw_message && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-text-faint">
                      Original message
                    </summary>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-bg p-3 text-xs text-text-muted">
                      {s.raw_message}
                    </pre>
                  </details>
                )}
                <div className="mt-3">
                  <ReviewControls signalId={s.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text">Released signals</h2>
        {released.length === 0 ? (
          <EmptyState title="No released signals yet" />
        ) : (
          <div className="space-y-3">
            {released.map((s) => (
              <div key={s.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/signals/${s.id}`} className="font-medium text-text hover:underline">
                    {s.symbol}
                  </Link>
                  <span className={s.direction === "BUY" ? "text-xs text-up" : "text-xs text-down"}>
                    {s.direction === "BUY" ? "LONG" : "SHORT"}
                  </span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
                    {s.status.replace(/_/g, " ")}
                  </span>
                  <span className="ml-auto text-xs text-text-faint">
                    {s.signal_sources?.name ?? "unknown source"}
                  </span>
                </div>
                <div className="mt-3">
                  <LifecycleControls signalId={s.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-4 text-sm font-medium text-text">Enter a signal manually</h2>
        <SignalComposer sources={sources} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text">Signal sources</h2>
        <SourceManager sources={sources} />
      </section>

      <section>
        <h2 className="mb-1 text-sm font-medium text-text">Telegram inbox</h2>
        <p className="mb-3 text-xs text-text-muted">
          Every inbound message, stored verbatim before any interpretation. A
          message the parser could not read shows here as a parse failure with
          the reason — it is never turned into a signal with guessed levels.
        </p>
        {inbox.length === 0 ? (
          <EmptyState
            title="No inbound messages"
            body="Point the Telegram bot webhook at /api/telegram/webhook and bind the channel's chat id to a source above."
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-text-faint">
                  <th className="px-4 py-2 font-normal">Received</th>
                  <th className="px-4 py-2 font-normal">Chat</th>
                  <th className="px-4 py-2 font-normal">Message</th>
                  <th className="px-4 py-2 font-normal">Result</th>
                </tr>
              </thead>
              <tbody>
                {inbox.map((m) => (
                  <tr key={m.id} className="border-t border-border align-top">
                    <td className="px-4 py-2 text-xs text-text-faint">
                      {new Date(m.received_at).toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-2 text-xs text-text-faint">{m.chat_id}</td>
                    <td className="max-w-md px-4 py-2 text-xs text-text-muted">
                      <span className="line-clamp-3 whitespace-pre-wrap">{m.text}</span>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <span
                        className={
                          m.parse_status === "parsed"
                            ? "text-up"
                            : m.parse_status === "unparseable"
                              ? "text-down"
                              : "text-text-faint"
                        }
                      >
                        {m.parse_status}
                      </span>
                      {m.parse_error && (
                        <span className="block text-text-faint">{m.parse_error}</span>
                      )}
                      {m.signal_id && (
                        <Link
                          href={`/signals/${m.signal_id}`}
                          className="block text-accent hover:underline"
                        >
                          view signal
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function level(n: number | null): string {
  return n !== null ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "not provided";
}
