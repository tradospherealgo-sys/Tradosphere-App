"use client";

import { useState, useTransition } from "react";
import { setSignalSourceActive, upsertSignalSource } from "@/lib/signals/admin-actions";
import type { SignalSource, SignalSourceKind } from "@/types/database";

const KINDS: { value: SignalSourceKind; label: string }[] = [
  { value: "smc_specialist", label: "SMC specialist (human desk analyst)" },
  { value: "smc_auto_trender", label: "SMC Auto Trender (algorithmic)" },
  { value: "tradosphere_ai", label: "Tradosphere analysis layer" },
  { value: "telegram_channel", label: "Telegram channel" },
  { value: "manual", label: "Desk (manual entry)" },
];

/**
 * `telegram_chat_id` is not a secret — the bot token is, and it lives in an
 * env var referenced by the integration config, never in this table.
 */
export function SourceManager({ sources }: { sources: SignalSource[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SignalSourceKind>("smc_specialist");
  const [chatId, setChatId] = useState("");
  const [description, setDescription] = useState("");
  const [isTrusted, setIsTrusted] = useState(false);
  const [autoVerify, setAutoVerify] = useState(false);

  return (
    <div className="space-y-6">
      {sources.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised/40 text-left text-xs uppercase tracking-wide text-text-faint">
                <th className="px-4 py-2 font-normal">Name</th>
                <th className="px-4 py-2 font-normal">Kind</th>
                <th className="px-4 py-2 font-normal">Telegram chat</th>
                <th className="px-4 py-2 font-normal">Trusted</th>
                <th className="px-4 py-2 font-normal">Auto-verify</th>
                <th className="px-4 py-2 font-normal">State</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-t border-border transition-colors hover:bg-surface-raised/30">
                  <td className="px-4 py-2 text-text">
                    {s.name}
                    <span className="block text-xs text-text-faint">{s.slug}</span>
                  </td>
                  <td className="px-4 py-2 text-text-muted">{s.kind}</td>
                  <td className="px-4 py-2 text-text-faint">{s.telegram_chat_id ?? "—"}</td>
                  <td className={`px-4 py-2 ${s.is_trusted ? "text-up" : "text-text-faint"}`}>
                    {s.is_trusted ? "yes" : "no"}
                  </td>
                  <td className={`px-4 py-2 ${s.auto_verify ? "text-warn" : "text-text-faint"}`}>
                    {s.auto_verify ? "yes" : "no"}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          setError(null);
                          const res = await setSignalSourceActive(s.id, !s.is_active);
                          if (!res.ok) setError(res.error);
                        })
                      }
                      className="h-9 rounded-full border border-border px-3 text-xs text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
                    >
                      {s.is_active ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 md:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const res = await upsertSignalSource(null, {
              slug,
              name,
              kind,
              description: description.trim() || null,
              telegramChatId: chatId.trim() || null,
              isTrusted,
              autoVerify,
            });
            if (res.ok) {
              setSlug("");
              setName("");
              setChatId("");
              setDescription("");
              setIsTrusted(false);
              setAutoVerify(false);
            } else {
              setError(res.error);
            }
          });
        }}
      >
        <h3 className="text-sm font-medium text-text">Register a source</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-text-faint">Slug</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
              placeholder="smc-desk-equity"
            />
          </div>
          <div>
            <label className="block text-xs text-text-faint">Display name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
            />
          </div>
          <div>
            <label className="block text-xs text-text-faint">Kind</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SignalSourceKind)}
              className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-faint">
              Telegram chat id {kind === "telegram_channel" ? "" : "(optional)"}
            </label>
            <input
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
              placeholder="-1001234567890"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-text-faint">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-base text-text"
          />
        </div>
        <label className="flex items-center gap-3 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={isTrusted}
            onChange={(e) => setIsTrusted(e.target.checked)}
            className="size-5"
          />
          Trusted source
        </label>
        <label className="flex items-start gap-3 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={autoVerify}
            onChange={(e) => setAutoVerify(e.target.checked)}
            disabled={!isTrusted}
            className="mt-0.5 size-5"
          />
          <span>
            Auto-verify — release this source&rsquo;s calls to clients without human
            review. Only available for a trusted source.
          </span>
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="h-11 rounded-lg bg-accent px-5 text-sm font-medium text-bg hover:bg-accent-strong disabled:opacity-50"
          >
            {pending ? "Saving…" : "Add source"}
          </button>
          {error && <span className="text-xs text-down">{error}</span>}
        </div>
      </form>
    </div>
  );
}
