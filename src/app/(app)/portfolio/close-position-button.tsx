"use client";

import { useTransition } from "react";
import { closePosition } from "@/lib/trading/actions";

export function ClosePositionButton({ positionId }: { positionId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() =>
        startTransition(() => {
          void closePosition(positionId);
        })
      }
      disabled={pending}
      className="min-h-9 rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
    >
      {pending ? "Closing…" : "Close"}
    </button>
  );
}
