"use client";

import { useState, useTransition } from "react";
import { createInviteCode, setInviteCodeActive } from "@/lib/invite-codes/actions";
import type { InviteCode } from "@/types/database";

const input =
  "min-h-11 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm text-text";
const label = "text-xs text-text-faint";

function date(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function randomCode(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

export function InviteCodeEditor({ codes }: { codes: InviteCode[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(form: FormData) {
    setError(null);
    const draft = {
      code: String(form.get("code") ?? ""),
      note: String(form.get("note") ?? ""),
      maxUses: Number(form.get("max_uses") ?? 1),
      expiresAt: String(form.get("expires_at") ?? ""),
    };
    startTransition(async () => {
      const result = await createInviteCode(draft);
      if (!result.ok) setError(result.error);
    });
  }

  function toggle(c: InviteCode) {
    startTransition(async () => {
      const result = await setInviteCodeActive(c.id, !c.is_active);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-raised/40 text-left text-xs uppercase tracking-wide text-text-faint">
              <th className="pb-2 font-normal">Code</th>
              <th className="pb-2 font-normal">Note</th>
              <th className="pb-2 font-normal">Uses</th>
              <th className="pb-2 font-normal">Expires</th>
              <th className="pb-2 font-normal">Active</th>
              <th className="pb-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.id} className="border-t border-border transition-colors hover:bg-surface-raised/30">
                <td className="py-2 font-mono text-text">{c.code}</td>
                <td className="py-2 text-xs text-text-muted">{c.note ?? "—"}</td>
                <td className="py-2 tabular-nums text-text-muted">
                  {c.use_count} / {c.max_uses}
                </td>
                <td className="py-2 text-text-muted">{date(c.expires_at)}</td>
                <td className={`py-2 ${c.is_active ? "text-up" : "text-text-faint"}`}>
                  {c.is_active ? "yes" : "no"}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggle(c)}
                    disabled={pending}
                    className="text-xs text-text-muted disabled:opacity-50"
                  >
                    {c.is_active ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
            {codes.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-sm text-text-muted">
                  No invite codes yet. Create the first one below.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <form
        key={codes.length}
        action={submit}
        className="flex flex-col gap-3 border-t border-border pt-5"
      >
        <p className="text-sm font-medium text-text">Create an invite code</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={label}>Code</span>
            <input name="code" required defaultValue={randomCode()} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Max uses</span>
            <input
              name="max_uses"
              type="number"
              min={1}
              defaultValue={1}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Expires at (optional)</span>
            <input name="expires_at" type="date" className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Note (optional)</span>
            <input name="note" placeholder="e.g. beta cohort 1" className={input} />
          </label>
        </div>
        {error ? <p className="text-sm text-down">{error}</p> : null}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-xl bg-accent px-5 text-sm font-medium text-bg disabled:opacity-50"
          >
            Create code
          </button>
        </div>
      </form>
    </div>
  );
}
