import Link from "next/link";
import {
  AlertTriangle,
  ListChecks,
  MessageSquare,
  Pencil,
  Radio,
  Send,
  Zap,
} from "lucide-react";
import {
  getAllSignals,
  getAllSignalSources,
  getRecentDistributionLogs,
  getSignalReviewQueue,
  getTelegramInbox,
  getUnresolvedWorkflowErrors,
} from "@/lib/signals/admin-reads";
import { EmptyState } from "@/components/empty-state";
import { LifecycleControls, ResolveWorkflowErrorControl, ReviewControls } from "./review-controls";
import { SignalComposer } from "./signal-composer";
import { SourceManager } from "./source-manager";

export const dynamic = "force-dynamic";

export default async function AdminSignalsPage() {
  const [queue, all, sources, inbox, workflowErrors, distributionLogs] = await Promise.all([
    getSignalReviewQueue(),
    getAllSignals(60),
    getAllSignalSources(),
    getTelegramInbox(40),
    getUnresolvedWorkflowErrors(40),
    getRecentDistributionLogs(40),
  ]);

  const DISTRIBUTION_STATUS_STYLES: Record<string, string> = {
    sent: "text-up",
    pending: "text-text-faint",
    retrying: "text-warn",
    failed: "text-down",
  };

  const released = all.filter(
    (s) => s.verification_state === "verified" && s.status !== "pending"
  );

  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text">
          <Radio className="size-5 text-accent" aria-hidden />
          Signal Desk
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Nothing reaches a client dashboard until it is verified here.
          Verifying a signal releases it to every subscriber and sends a
          broadcast notification in the same transaction.
        </p>
      </header>

      <section>
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-text">
          <ListChecks className="size-4 text-accent" aria-hidden />
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
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-text">
          <Send className="size-4 text-accent" aria-hidden />
          Released signals
        </h2>
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
        <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-text">
          <Pencil className="size-4 text-accent" aria-hidden />
          Enter a signal manually
        </h2>
        <SignalComposer sources={sources} />
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-text">
          <Radio className="size-4 text-accent" aria-hidden />
          Signal sources
        </h2>
        <SourceManager sources={sources} />
      </section>

      <section>
        <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-text">
          <AlertTriangle className="size-4 text-accent" aria-hidden />
          Pipeline errors {workflowErrors.length > 0 ? `(${workflowErrors.length})` : ""}
        </h2>
        <p className="mb-3 text-xs text-text-muted">
          Failures caught by the n8n Signal OS pipeline — an AI call that
          failed, malformed output, a rejected insert, or an unreachable
          distribution destination. Resolving here just clears the flag; it
          does not retry the underlying stage.
        </p>
        {workflowErrors.length === 0 ? (
          <EmptyState title="No unresolved pipeline errors" />
        ) : (
          <div className="space-y-3">
            {workflowErrors.map((e) => (
              <div key={e.id} className="rounded-2xl border border-down/30 bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-text">{e.workflow_name}</span>
                  <span className="text-xs text-text-faint">{e.node_name}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
                    {e.stage}
                  </span>
                  <span className="ml-auto text-xs text-text-faint">
                    {new Date(e.occurred_at).toLocaleString("en-IN")}
                  </span>
                </div>
                <p className="mt-2 text-sm text-down">{e.error_message}</p>
                <div className="mt-3">
                  <ResolveWorkflowErrorControl errorId={e.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-text">
          <Zap className="size-4 text-accent" aria-hidden />
          Distribution log
        </h2>
        <p className="mb-3 text-xs text-text-muted">
          Per-destination delivery attempts for published signals, written by
          the n8n pipeline. Read-only — a failed send is retried by the
          workflow itself, not from here.
        </p>
        {distributionLogs.length === 0 ? (
          <EmptyState title="No distribution attempts recorded yet" />
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-raised/40 text-left text-xs uppercase tracking-wide text-text-faint">
                  <th className="pb-2 font-normal">Signal</th>
                  <th className="pb-2 font-normal">Destination</th>
                  <th className="pb-2 font-normal">Status</th>
                  <th className="pb-2 font-normal">Attempts</th>
                  <th className="pb-2 font-normal">Last error</th>
                  <th className="pb-2 font-normal">Updated</th>
                </tr>
              </thead>
              <tbody>
                {distributionLogs.map((d) => (
                  <tr key={d.id} className="border-t border-border transition-colors hover:bg-surface-raised/30">
                    <td className="py-2 text-text">
                      {d.signals?.symbol ?? "—"}{" "}
                      <span className="text-xs text-text-faint">{d.signals?.category}</span>
                    </td>
                    <td className="py-2 text-text-muted">{d.destination}</td>
                    <td className={`py-2 ${DISTRIBUTION_STATUS_STYLES[d.status] ?? ""}`}>
                      {d.status}
                    </td>
                    <td className="py-2 tabular-nums text-text-muted">{d.attempt_count}</td>
                    <td className="py-2 text-xs text-down">{d.last_error ?? "—"}</td>
                    <td className="py-2 text-xs text-text-faint">
                      {new Date(d.updated_at).toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-text">
          <MessageSquare className="size-4 text-accent" aria-hidden />
          Telegram inbox
        </h2>
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
                <tr className="border-b border-border bg-surface-raised/40 text-left text-xs uppercase tracking-wide text-text-faint">
                  <th className="px-4 py-2 font-normal">Received</th>
                  <th className="px-4 py-2 font-normal">Chat</th>
                  <th className="px-4 py-2 font-normal">Message</th>
                  <th className="px-4 py-2 font-normal">Result</th>
                </tr>
              </thead>
              <tbody>
                {inbox.map((m) => (
                  <tr key={m.id} className="border-t border-border align-top transition-colors hover:bg-surface-raised/30">
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
