"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { calcGreeks, daysToExpiry } from "@/lib/options/calc";
import type { ChainAnalysis } from "@/lib/options/analysis";
import type { OptionChainSnapshot } from "@/lib/options/types";
import type { MarketStatus } from "@/lib/market-data/market-hours";
import { OptionChainTable, type Row } from "./option-chain-table";

/**
 * Option-chain workspace.
 *
 * The chain refreshes on a timer while the session is open and stops when it
 * closes — a chain that keeps repainting after 15:30 implies movement that
 * cannot be happening. `capturedAt` is always shown so the user can see how
 * old the snapshot is rather than inferring freshness from the fact that
 * numbers are on screen.
 */

const UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];
const REFRESH_OPEN_MS = 15_000;

type ChainResponse = {
  configured: boolean;
  provider: string;
  status: MarketStatus;
  underlying: string;
  expiries: string[];
  snapshot: OptionChainSnapshot | null;
  analysis: ChainAnalysis | null;
};

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | ({ state: "ready" } & ChainResponse);

type Settled = Exclude<Load, { state: "loading" }> & { key: string };

export function OptionChainPanel({ initialUnderlying }: { initialUnderlying: string }) {
  const [underlying, setUnderlying] = useState(initialUnderlying);
  const [expiry, setExpiry] = useState<string>("");
  const [tick, setTick] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  const requestKey = `${underlying}:${expiry}`;
  // Loading is derived, not stored: a result only counts if it answers the
  // request currently on screen, so switching underlying shows a spinner
  // rather than the previous instrument's strikes. Memoized because the Greeks
  // computation below keys off this object.
  const load = useMemo<Load>(
    () => (settled?.key === requestKey ? settled : { state: "loading" }),
    [settled, requestKey]
  );

  useEffect(() => {
    const controller = new AbortController();

    fetchChain(underlying, expiry, controller.signal)
      .then((result) => setSettled({ key: requestKey, ...result }))
      .catch((error: Error) => {
        if (error.name === "AbortError") return;
        setSettled({
          key: requestKey,
          state: "error",
          message: "Couldn't reach the option-chain service. Check your connection and try again.",
        });
      });

    return () => controller.abort();
    // `tick` is a deliberate dependency: incrementing it is what drives the
    // auto-refresh, and it is otherwise unused inside the effect.
  }, [underlying, expiry, requestKey, tick]);

  const isOpen = load.state === "ready" && load.status.isOpen;
  useEffect(() => {
    if (!isOpen) return;
    const timer = setInterval(() => setTick((value) => value + 1), REFRESH_OPEN_MS);
    return () => clearInterval(timer);
  }, [isOpen]);

  const rows = useMemo<Row[]>(() => {
    if (load.state !== "ready" || !load.snapshot) return [];
    const snapshot = load.snapshot;
    const spot = snapshot.spotAtCapture;
    const tYears = daysToExpiry(snapshot.expiry) / 365;

    // Greeks the provider did not publish are derived from its own IV and
    // spot, and are labelled "est." in the table so a computed number is
    // never mistaken for an exchange-reported one.
    return snapshot.legs.map((leg) => ({
      leg,
      estimated:
        leg.delta === null && spot !== null && leg.iv !== null
          ? calcGreeks(spot, leg.strike, tYears, leg.iv, leg.optionType)
          : null,
    }));
  }, [load]);

  const expiries = load.state === "ready" ? load.expiries : [];
  const analysis = load.state === "ready" ? load.analysis : null;
  const snapshot = load.state === "ready" ? load.snapshot : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
        <div>
          <label className="block text-xs text-text-faint" htmlFor="oc-underlying">
            Underlying
          </label>
          <select
            id="oc-underlying"
            value={underlying}
            onChange={(event) => {
              setUnderlying(event.target.value);
              // The old expiry belongs to the old instrument's calendar.
              setExpiry("");
            }}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3 text-base text-text"
          >
            {UNDERLYINGS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-faint" htmlFor="oc-expiry">
            Expiry
          </label>
          <select
            id="oc-expiry"
            value={expiry || snapshot?.expiry || ""}
            disabled={expiries.length === 0}
            onChange={(event) => setExpiry(event.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3 text-base text-text disabled:opacity-50"
          >
            {expiries.length === 0 ? (
              <option value="">—</option>
            ) : (
              expiries.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))
            )}
          </select>
          {load.state === "ready" && expiries.length === 0 ? (
            <p className="mt-1 text-xs text-text-faint">
              No expiries available for {underlying} right now.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setTick((value) => value + 1)}
          className="h-11 rounded-lg border border-border px-4 text-sm text-text-muted hover:border-accent hover:text-text"
        >
          Refresh
        </button>
        {load.state === "ready" ? (
          <p className="text-xs text-text-faint">
            {load.status.label}
            {load.status.isOpen ? ` · auto-refreshing every ${REFRESH_OPEN_MS / 1000}s` : ""}
          </p>
        ) : null}
      </div>

      {load.state === "loading" ? (
        <div role="status" className="py-16 text-center text-sm text-text-muted">
          Loading {underlying} chain…
        </div>
      ) : load.state === "error" ? (
        <EmptyState title="Option chain unavailable" body={load.message} />
      ) : !load.configured ? (
        <EmptyState
          title="No option-chain provider configured"
          body="An admin needs to enable one in Admin → Integrations before the chain can render."
        />
      ) : !snapshot || !analysis ? (
        <EmptyState
          title="No chain available"
          body={`The provider returned no mappable legs for ${underlying}. It may be outside market hours, or the response mapping needs adjusting in Admin → Integrations.`}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Spot at capture" value={inr(snapshot.spotAtCapture)} />
            <Metric label="ATM strike" value={inr(analysis.atmStrike)} />
            <Metric label="PCR (OI)" value={analysis.pcr?.toFixed(2) ?? "—"} />
            <Metric label="Max pain" value={inr(analysis.maxPain)} />
          </div>

          <OiAnalysis analysis={analysis} />

          <OptionChainTable
            rows={rows}
            atmStrike={analysis.atmStrike}
            maxLegOi={analysis.maxLegOi}
          />

          <p className="text-xs text-text-faint">
            Captured {new Date(snapshot.capturedAt).toLocaleString("en-IN")} from{" "}
            {snapshot.source}. Greeks marked &ldquo;est.&rdquo; are computed from the
            provider&rsquo;s own IV and spot, not reported by the exchange.
          </p>
        </>
      )}
    </div>
  );
}

function OiAnalysis({ analysis }: { analysis: ChainAnalysis }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-text"><BarChart3 className="size-4 text-accent" aria-hidden />Open interest analysis</h2>
      <p className="mt-1 text-xs text-text-faint">
        Derived from the OI in this snapshot. Peak-OI strikes are the
        conventional reading of writer positioning, not a forecast.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="OI resistance (max call OI)"
          value={inr(analysis.maxCallOiStrike?.strike ?? null)}
          sub={analysis.maxCallOiStrike ? `${compact(analysis.maxCallOiStrike.oi)} OI` : undefined}
        />
        <Metric
          label="OI support (max put OI)"
          value={inr(analysis.maxPutOiStrike?.strike ?? null)}
          sub={analysis.maxPutOiStrike ? `${compact(analysis.maxPutOiStrike.oi)} OI` : undefined}
        />
        <Metric label="PCR (volume)" value={analysis.volumePcr?.toFixed(2) ?? "—"} />
        <Metric
          label="Net ΔOI (puts − calls)"
          value={analysis.netChangeOi === null ? "—" : compact(analysis.netChangeOi)}
        />
      </div>

      {analysis.topOiBuildup.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs text-text-faint">Largest OI change today</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {analysis.topOiBuildup.map((entry) => (
              <li
                key={`${entry.strike}-${entry.optionType}`}
                className="rounded-full border border-border px-3 py-1 text-xs text-text-muted"
              >
                {entry.strike.toLocaleString("en-IN")} {entry.optionType}{" "}
                <span className={entry.changeOi! >= 0 ? "text-up" : "text-down"}>
                  {entry.changeOi! >= 0 ? "+" : ""}
                  {compact(entry.changeOi!)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-text-faint">{label}</p>
      <p className="mt-1 text-lg font-medium text-text">{value}</p>
      {sub ? <p className="text-xs text-text-faint">{sub}</p> : null}
    </div>
  );
}

async function fetchChain(
  underlying: string,
  expiry: string,
  signal: AbortSignal
): Promise<Exclude<Load, { state: "loading" }>> {
  const query = new URLSearchParams({ underlying });
  if (expiry) query.set("expiry", expiry);

  const response = await fetch(`/api/market/option-chain?${query}`, { signal });
  const body = await response.json();

  if (!response.ok) {
    return {
      state: "error",
      message:
        body?.error ??
        "Couldn't load the option chain. Try reloading — if it keeps happening, this underlying or expiry may not be supported yet.",
    };
  }
  return { state: "ready", ...(body as ChainResponse) };
}

function inr(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-IN");
}

/** Indian-market OI is quoted in lakhs/crores; raw digits are unreadable. */
function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `${(value / 10_000_000).toFixed(2)}Cr`;
  if (abs >= 100_000) return `${(value / 100_000).toFixed(2)}L`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("en-IN");
}
