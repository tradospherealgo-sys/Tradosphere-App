"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { updateLessonProgress } from "@/lib/education/actions";

export function LessonProgressButton({
  lessonId,
  progressPct,
}: {
  lessonId: string;
  progressPct: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const done = progressPct >= 100;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await updateLessonProgress(lessonId, done ? 0 : 100);
            if (!result.ok) setError(result.error);
          })
        }
        className={`flex min-h-11 items-center gap-1.5 rounded-xl border px-5 text-sm disabled:opacity-50 ${
          done
            ? "border-up text-up"
            : "border-border text-text-muted hover:border-accent hover:text-text"
        }`}
      >
        {done ? <CheckCircle2 className="size-4" aria-hidden /> : null}
        {done ? "Completed — mark unread" : "Mark complete"}
      </button>
      {error ? <p className="text-xs text-down">{error}</p> : null}
    </div>
  );
}
