"use client";

import { useState, useTransition } from "react";
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
        className={`min-h-11 rounded-xl border px-5 text-sm disabled:opacity-50 ${
          done
            ? "border-up text-up"
            : "border-border text-text-muted hover:border-accent hover:text-text"
        }`}
      >
        {done ? "Completed — mark unread" : "Mark complete"}
      </button>
      {error ? <p className="text-xs text-down">{error}</p> : null}
    </div>
  );
}
