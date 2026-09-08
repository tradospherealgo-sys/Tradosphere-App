"use client";

import { useState, useTransition } from "react";
import { updateSystemSetting } from "@/lib/admin/actions";

export function SettingRow({
  settingKey,
  value,
  description,
}: {
  settingKey: string;
  value: unknown;
  description: string | null;
}) {
  const [text, setText] = useState(JSON.stringify(value));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-text">{settingKey}</p>
      {description && <p className="text-xs text-text-faint">{description}</p>}
      <div className="mt-2 flex items-end gap-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-text"
        />
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await updateSystemSetting(settingKey, text);
              setMessage(res.ok ? "Saved." : res.error);
            })
          }
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
        >
          Save
        </button>
      </div>
      {message && <p className="mt-1 text-xs text-text-faint">{message}</p>}
    </div>
  );
}
