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
      className="rounded-lg border border-border px-2.5 py-1 text-xs text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
    >
      {pending ? "Closing…" : "Close"}
    </button>
  );
}
