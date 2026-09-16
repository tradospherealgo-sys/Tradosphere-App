"use client";

import { useState, useTransition } from "react";
import {
  cancelSubscription,
  grantSubscription,
  suspendSubscription,
  unsuspendSubscription,
} from "@/lib/subscriptions/actions";
import type { Plan } from "@/types/database";

const input =
  "min-h-11 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm text-text";

export function GrantForm({
  plans,
  clients,
}: {
  plans: Plan[];
  clients: { id: string; email: string; full_name: string | null }[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(form: FormData) {
    setError(null);
    setMessage(null);
    const userId = String(form.get("user_id") ?? "");
    const planId = String(form.get("plan_id") ?? "");
    startTransition(async () => {
      const result = await grantSubscription(userId, planId);
      if (result.ok) setMessage("Subscription granted.");
      else setError(result.error);
    });
  }

  if (plans.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        Create an active plan before granting access.
      </p>
    );
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <p className="text-xs text-text-faint">
        A grant is comped access, recorded as source “admin_grant” — it is never
        counted as revenue.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-faint">Client</span>
          <select name="user_id" required className={input} defaultValue="">
            <option value="" disabled>
              Select a client
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name ? `${c.full_name} — ${c.email}` : c.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-faint">Plan</span>
          <select name="plan_id" required className={input} defaultValue="">
            <option value="" disabled>
              Select a plan
            </option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.billing_interval})
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 w-full rounded-xl bg-accent px-5 text-sm font-medium text-bg disabled:opacity-50"
          >
            {pending ? "Granting…" : "Grant access"}
          </button>
        </div>
      </div>
      {error ? <p className="text-sm text-down">{error}</p> : null}
      {message ? <p className="text-sm text-up">{message}</p> : null}
    </form>
  );
}

export function CancelButton({ subscriptionId }: { subscriptionId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await cancelSubscription(subscriptionId);
            if (!result.ok) setError(result.error);
          })
        }
        className="text-xs text-down disabled:opacity-50"
      >
        {pending ? "Cancelling…" : "Cancel"}
      </button>
      {error ? <span className="ml-2 text-xs text-down">{error}</span> : null}
    </>
  );
}

/** Pauses access reversibly — distinct from Cancel, which ends the subscription outright. */
export function SuspendButton({ subscriptionId }: { subscriptionId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");

  if (showReason) {
    return (
      <div className="flex items-center gap-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="min-h-8 w-32 rounded-lg border border-border bg-surface-raised px-2 text-xs text-text"
        />
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await suspendSubscription(subscriptionId, reason);
              if (!result.ok) setError(result.error);
              else setShowReason(false);
            })
          }
          className="inline-flex min-h-11 items-center text-xs text-warn disabled:opacity-50"
        >
          {pending ? "Suspending…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => setShowReason(false)}
          className="inline-flex min-h-11 items-center text-xs text-text-faint"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowReason(true)}
        className="inline-flex min-h-11 items-center text-xs text-warn"
      >
        Suspend
      </button>
      {error ? <span className="ml-2 text-xs text-down">{error}</span> : null}
    </>
  );
}

export function UnsuspendButton({ subscriptionId }: { subscriptionId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await unsuspendSubscription(subscriptionId);
            if (!result.ok) setError(result.error);
          })
        }
        className="inline-flex min-h-11 items-center text-xs text-up disabled:opacity-50"
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error ? <span className="ml-2 text-xs text-down">{error}</span> : null}
    </>
  );
}
