"use client";

import { useState, useTransition } from "react";
import { resolveWorkflowError, updateSignalStatus, verifySignal } from "@/lib/signals/admin-actions";
import type { SignalStatus } from "@/types/database";

const LIFECYCLE: { value: SignalStatus; label: string }[] = [
  { value: "triggered", label: "Entry triggered" },
  { value: "target_hit", label: "Target hit" },
  { value: "stopped_out", label: "Stopped out" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * Verifying a signal releases it to every client and fires a broadcast
 * notification, so the destructive-looking half (reject) and the
 * irreversible half (release) are both single, explicit clicks with the
 * consequence spelled out next to them rather than hidden in a menu.
 */
export function ReviewControls({ signalId }: { signalId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (release: boolean) =>
    start(async () => {
      setError(null);
      const res = await verifySignal(signalId, release);
      if (!res.ok) setError(res.error);
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(true)}
        className="h-11 rounded-lg bg-accent px-4 text-sm font-medium text-bg hover:bg-accent-strong disabled:opacity-50"
      >
        Verify &amp; release
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(false)}
        className="h-11 rounded-lg border border-down/40 px-4 text-sm text-down hover:bg-down/10 disabled:opacity-50"
      >
        Reject
      </button>
      {error && <span className="text-xs text-down">{error}</span>}
    </div>
  );
}

export function ResolveWorkflowErrorControl({ errorId }: { errorId: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await resolveWorkflowError(errorId);
            if (!res.ok) setError(res.error);
          })
        }
        className="h-9 rounded-lg border border-border px-3 text-xs text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
      >
        {pending ? "Resolving…" : "Mark resolved"}
      </button>
      {error && <span className="text-xs text-down">{error}</span>}
    </div>
  );
}

export function LifecycleControls({ signalId }: { signalId: string }) {
  const [status, setStatus] = useState<SignalStatus>("triggered");
  const [detail, setDetail] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-xs text-text-faint">Set status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as SignalStatus)}
          className="mt-1 h-11 rounded-lg border border-border bg-bg px-3 text-base text-text"
        >
          {LIFECYCLE.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-[12rem] flex-1">
        <label className="block text-xs text-text-faint">Note (shown to clients)</label>
        <input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          placeholder="optional"
        />
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await updateSignalStatus(signalId, status, detail.trim() || null);
            if (res.ok) setDetail("");
            else setError(res.error);
          })
        }
        className="h-11 rounded-lg border border-border px-4 text-sm text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
      >
        {pending ? "Updating…" : "Update"}
      </button>
      {error && <span className="text-xs text-down">{error}</span>}
    </div>
  );
}
