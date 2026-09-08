"use client";

import { useState } from "react";
import type { Greeks } from "@/lib/options/calc";
import type { OptionLeg } from "@/lib/options/types";

type Row = { leg: OptionLeg; estimated: Greeks | null };

/**
 * The classic CE-left / strike-centre / PE-right chain layout.
 *
 * On a phone the full grid is far too wide to read, so the "Compact" mode
 * (default under `sm`) drops to LTP + OI per side. The toggle is explicit
 * rather than a pure CSS breakpoint because traders on a large phone often
 * want the full grid and will scroll horizontally for it.
 */
export function OptionChainTable({
  rows,
  atmStrike,
}: {
  rows: Row[];
  atmStrike: number | null;
}) {
  const [compact, setCompact] = useState(true);

  const strikes = Array.from(new Set(rows.map((r) => r.leg.strike))).sort((a, b) => a - b);
  const byStrike = new Map<number, { CE?: Row; PE?: Row }>();
  for (const row of rows) {
    const entry = byStrike.get(row.leg.strike) ?? {};
    entry[row.leg.optionType] = row;
    byStrike.set(row.leg.strike, entry);
  }

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setCompact((v) => !v)}
          className="h-9 rounded-full border border-border px-3 text-xs text-text-muted hover:border-accent hover:text-text"
        >
          {compact ? "Show all columns" : "Compact view"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-text-faint">
              <th
                colSpan={compact ? 2 : 6}
                className="px-3 py-2 text-center font-normal text-up"
              >
                CALLS
              </th>
              <th className="px-3 py-2 text-center font-normal">Strike</th>
              <th
                colSpan={compact ? 2 : 6}
                className="px-3 py-2 text-center font-normal text-down"
              >
                PUTS
              </th>
            </tr>
            <tr className="border-b border-border text-xs text-text-faint">
              {sideHeaders(compact, "CE")}
              <th className="px-3 py-2 font-normal" />
              {sideHeaders(compact, "PE")}
            </tr>
          </thead>
          <tbody>
            {strikes.map((strike) => {
              const entry = byStrike.get(strike) ?? {};
              const isAtm = strike === atmStrike;
              return (
                <tr
                  key={strike}
                  className={`border-t border-border ${isAtm ? "bg-accent/10" : ""}`}
                >
                  {sideCells(entry.CE, compact, "CE", atmStrike, strike)}
                  <td
                    className={`px-3 py-2 text-center font-medium ${
                      isAtm ? "text-accent-strong" : "text-text"
                    }`}
                  >
                    {strike.toLocaleString("en-IN")}
                  </td>
                  {sideCells(entry.PE, compact, "PE", atmStrike, strike)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sideHeaders(compact: boolean, side: "CE" | "PE") {
  const labels = compact
    ? ["OI", "LTP"]
    : ["OI", "ΔOI", "Vol", "IV", "Δ", "LTP"];
  const ordered = side === "CE" ? labels : [...labels].reverse();
  return ordered.map((l) => (
    <th key={`${side}-${l}`} className="px-3 py-2 text-right font-normal">
      {l}
    </th>
  ));
}

function sideCells(
  row: Row | undefined,
  compact: boolean,
  side: "CE" | "PE",
  atmStrike: number | null,
  strike: number
) {
  const leg = row?.leg;
  const est = row?.estimated;

  // In-the-money legs get a tinted background, the standard chain convention.
  const itm =
    atmStrike !== null &&
    (side === "CE" ? strike < atmStrike : strike > atmStrike);
  const cls = `px-3 py-2 text-right ${itm ? "bg-surface-raised" : ""}`;

  const delta =
    leg?.delta !== null && leg?.delta !== undefined
      ? String(leg.delta)
      : est
        ? `${est.delta} est.`
        : "—";

  const cells = compact
    ? [num(leg?.oi), num(leg?.ltp)]
    : [num(leg?.oi), num(leg?.changeOi), num(leg?.volume), num(leg?.iv), delta, num(leg?.ltp)];

  const ordered = side === "CE" ? cells : [...cells].reverse();
  return ordered.map((value, i) => (
    <td key={`${side}-${i}`} className={cls}>
      <span className={i === ordered.length - 1 || compact ? "text-text" : "text-text-muted"}>
        {value}
      </span>
    </td>
  ));
}

function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-IN");
}
