"use client";

import { useState, useTransition } from "react";
import { updateProfileName, updateRiskPerTrade } from "@/lib/app-data/actions";

export function SettingsForm({
  initialName,
  initialRiskPct,
}: {
  initialName: string;
  initialRiskPct: number;
}) {
  const [name, setName] = useState(initialName);
  const [riskPct, setRiskPct] = useState(initialRiskPct);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [riskMsg, setRiskMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-6">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setNameMsg(null);
          startTransition(async () => {
            const res = await updateProfileName(name);
            setNameMsg(res.ok ? "Saved." : res.error);
          });
        }}
      >
        <div>
          <label className="block text-xs text-text-faint">Full name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
        >
          Save name
        </button>
        {nameMsg && <p className="text-xs text-text-faint">{nameMsg}</p>}
      </form>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setRiskMsg(null);
          startTransition(async () => {
            const res = await updateRiskPerTrade(riskPct);
            setRiskMsg(res.ok ? "Saved." : res.error);
          });
        }}
      >
        <div>
          <label className="block text-xs text-text-faint">Risk per trade (%)</label>
          <input
            type="number"
            step="0.1"
            min={0}
            max={100}
            value={riskPct}
            onChange={(e) => setRiskPct(Number(e.target.value))}
            className="mt-1 w-32 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
        >
          Save risk setting
        </button>
        {riskMsg && <p className="text-xs text-text-faint">{riskMsg}</p>}
      </form>
    </div>
  );
}
