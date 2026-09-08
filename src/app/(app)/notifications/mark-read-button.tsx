"use client";

import { useTransition } from "react";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/app-data/actions";

export function MarkReadButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() =>
        startTransition(() => {
          void markNotificationRead(id);
        })
      }
      disabled={pending}
      className="min-h-9 shrink-0 rounded-lg border border-border px-2.5 text-xs text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
    >
      Mark read
    </button>
  );
}

export function MarkAllReadButton({ unread }: { unread: number }) {
  const [pending, startTransition] = useTransition();
  if (unread === 0) return null;
  return (
    <button
      onClick={() =>
        startTransition(() => {
          void markAllNotificationsRead();
        })
      }
      disabled={pending}
      className="min-h-11 rounded-xl border border-border px-4 text-sm text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
    >
      Mark all {unread} read
    </button>
  );
}
