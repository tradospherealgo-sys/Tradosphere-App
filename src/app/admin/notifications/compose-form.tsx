"use client";

import { useState, useTransition } from "react";
import { sendNotification } from "@/lib/admin/actions";

export function ComposeForm() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("announcement");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const res = await sendNotification({ title, body, kind, userId: null });
          if (res.ok) {
            setMessage({ ok: true, text: "Broadcast sent." });
            setTitle("");
            setBody("");
          } else {
            setMessage({ ok: false, text: res.error });
          }
        });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <div className="flex-1">
          <label className="block text-xs text-text-faint">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text"
          />
        </div>
        <div>
          <label className="block text-xs text-text-faint">Kind</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text"
          >
            <option value="announcement">announcement</option>
            <option value="system">system</option>
            <option value="education">education</option>
            <option value="signal">signal</option>
            <option value="trade">trade</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-text-faint">Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-bg hover:bg-accent-strong disabled:opacity-50"
      >
        Broadcast to all users
      </button>
      {message && (
        <p className={`text-xs ${message.ok ? "text-up" : "text-down"}`}>{message.text}</p>
      )}
    </form>
  );
}
