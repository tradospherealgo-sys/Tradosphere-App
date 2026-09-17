"use client";

import { useState, useTransition } from "react";
import { MessageSquare } from "lucide-react";
import { postCoachMessage } from "@/lib/education/actions";

type CoachMessage = { id: number; role: "user" | "assistant"; content: string; created_at: string };

export function CoachThread({ messages }: { messages: CoachMessage[] }) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-text">
        <MessageSquare className="size-4 text-accent" aria-hidden />
        Coach journal
      </h2>
      <p className="mb-4 text-xs text-text-faint">
        A private log of your own reflections. There is no automated AI reply
        wired up yet — this app never fabricates a coach response.
      </p>

      <div className="mb-4 max-h-72 space-y-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-text-faint">No entries yet.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="rounded-lg bg-bg/40 px-3 py-2 text-sm text-text-muted">
              <p>{m.content}</p>
              <p className="mt-1 text-xs text-text-faint">
                {new Date(m.created_at).toLocaleString("en-IN")}
              </p>
            </div>
          ))
        )}
      </div>

      {error && <p className="mb-2 text-xs text-down">{error}</p>}

      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const res = await postCoachMessage(content);
            if (!res.ok) setError(res.error);
            else setContent("");
          });
        }}
      >
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text"
          placeholder="Log a trade reflection…"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent-strong disabled:opacity-50"
        >
          Save
        </button>
      </form>
    </div>
  );
}
