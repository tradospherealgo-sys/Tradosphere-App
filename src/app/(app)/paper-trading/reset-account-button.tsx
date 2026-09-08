"use client";

import { useState, useTransition } from "react";
import { resetPaperAccount } from "@/lib/trading/actions";

/**
 * Clears the book and restores starting capital. Two-step because it throws
 * away the user's trade history, which is the input to every analytic on the
 * journal page.
 */
export function ResetAccountButton() {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="h-9 rounded-lg border border-border px-3 text-xs text-text-muted hover:border-accent hover:text-text"
      >
        Reset paper account
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-warn">
        This deletes every order, position and closed trade. Not reversible.
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await resetPaperAccount();
            if (res.ok) setConfirming(false);
            else setError(res.error);
          })
        }
        className="h-9 rounded-lg bg-down px-3 font-medium text-bg disabled:opacity-50"
      >
        {pending ? "Resetting…" : "Confirm reset"}
      </button>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
          setError(null);
        }}
        className="h-9 rounded-lg border border-border px-3 text-text-muted"
      >
        Cancel
      </button>
      {error && <span className="text-down">{error}</span>}
    </span>
  );
}
