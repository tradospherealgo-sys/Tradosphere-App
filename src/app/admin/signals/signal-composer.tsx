"use client";

import { useState, useTransition } from "react";
import { createSignal } from "@/lib/signals/admin-actions";
import { TRADE_CATEGORIES, CATEGORY_LABELS } from "@/lib/signals/categories";
import type { InstrumentKind, OrderSide, SignalCategory } from "@/types/database";

type SourceOption = { id: string; name: string; kind: string; is_active: boolean };

const INSTRUMENTS: InstrumentKind[] = ["EQUITY", "INDEX_OPTION", "STOCK_OPTION"];

const num = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * Blank fields are submitted as null, not zero — an unpublished target must
 * reach the database as "absent" so the client UI can say "not provided".
 */
export function SignalComposer({ sources }: { sources: SourceOption[] }) {
  const active = sources.filter((s) => s.is_active);
  const [sourceId, setSourceId] = useState(active[0]?.id ?? "");
  const [symbol, setSymbol] = useState("");
  const [instrumentKind, setInstrumentKind] = useState<InstrumentKind>("EQUITY");
  const [category, setCategory] = useState<SignalCategory>("EQUITY");
  const [direction, setDirection] = useState<OrderSide>("BUY");
  const [f, setF] = useState<Record<string, string>>({});
  const [rationale, setRationale] = useState("");
  const [riskNote, setRiskNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const field = (k: string, label: string) => (
    <div>
      <label className="block text-xs text-text-faint">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        step="0.05"
        value={f[k] ?? ""}
        onChange={set(k)}
        placeholder="not provided"
        className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
      />
    </div>
  );

  if (active.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        Register at least one active signal source below before entering a call —
        every signal must carry a provenance record.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        start(async () => {
          const res = await createSignal({
            sourceId,
            symbol,
            instrumentKind,
            category,
            direction,
            entryPrice: num(f.entry ?? ""),
            entryLow: num(f.entryLow ?? ""),
            entryHigh: num(f.entryHigh ?? ""),
            stopLoss: num(f.sl ?? ""),
            target1: num(f.t1 ?? ""),
            target2: num(f.t2 ?? ""),
            target3: num(f.t3 ?? ""),
            confidence: num(f.confidence ?? ""),
            rationale: rationale.trim() || null,
            riskNote: riskNote.trim() || null,
            expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          });
          if (res.ok) {
            setMessage({ ok: true, text: "Saved as unverified — release it from the queue above." });
            setSymbol("");
            setF({});
            setRationale("");
            setRiskNote("");
            setExpiresAt("");
          } else {
            setMessage({ ok: false, text: res.error });
          }
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2">
          <label className="block text-xs text-text-faint">Source</label>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          >
            {active.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.kind})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-faint">Symbol</label>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            required
            autoCapitalize="characters"
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          />
        </div>
        <div>
          <label className="block text-xs text-text-faint">Instrument</label>
          <select
            value={instrumentKind}
            onChange={(e) => setInstrumentKind(e.target.value as InstrumentKind)}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          >
            {INSTRUMENTS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-faint">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as SignalCategory)}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          >
            {TRADE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-faint">Direction</label>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as OrderSide)}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          >
            <option value="BUY">BUY (long)</option>
            <option value="SELL">SELL (short)</option>
          </select>
        </div>
        {field("entry", "Entry")}
        {field("entryLow", "Entry range low")}
        {field("entryHigh", "Entry range high")}
        {field("sl", "Stop loss")}
        {field("t1", "Target 1")}
        {field("t2", "Target 2")}
        {field("t3", "Target 3")}
        {field("confidence", "Confidence %")}
        <div className="col-span-2">
          <label className="block text-xs text-text-faint">Valid until</label>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-text-faint">Rationale</label>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-base text-text"
        />
      </div>
      <div>
        <label className="block text-xs text-text-faint">Risk note</label>
        <textarea
          value={riskNote}
          onChange={(e) => setRiskNote(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-base text-text"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-lg bg-accent px-5 text-sm font-medium text-bg hover:bg-accent-strong disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save signal"}
        </button>
        {message && (
          <span className={`text-xs ${message.ok ? "text-up" : "text-down"}`}>{message.text}</span>
        )}
      </div>
    </form>
  );
}
