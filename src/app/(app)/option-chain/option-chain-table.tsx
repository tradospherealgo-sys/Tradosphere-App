"use client";

import { useState } from "react";
import type { Greeks } from "@/lib/options/calc";
import type { OptionLeg } from "@/lib/options/types";

export type Row = { leg: OptionLeg; estimated: Greeks | null };

/**
 * The classic CE-left / strike-centre / PE-right chain layout.
 *
 * On a phone the full grid is far too wide to read, so the compact mode
 * (default) drops to OI + LTP per side. The toggle is explicit rather than a
 * pure CSS breakpoint because traders on a large phone often want the full
 * grid and will scroll horizontally for it.
 *
 * OI is drawn as a bar behind the number, scaled against the largest single
 * leg in the chain. Reading where OI is concentrated is the main thing this
 * table is for, and a column of six-figure numbers does not communicate it.
 */
export function OptionChainTable({
  rows,
  atmStrike,
  maxLegOi,
}: {
  rows: Row[];
  atmStrike: number | null;
  maxLegOi: number | null;
}) {
  const [compact, setCompact] = useState(true);

  const strikes = Array.from(new Set(rows.map((r) => r.leg.strike))).sort((a, b) => a - b);
  const byStrike = new Map<number, { CE?: Row; PE?: Row }>();
  for (const row of rows) {
    const entry = byStrike.get(row.leg.strike) ?? {};
    entry[row.leg.optionType] = row;
    byStrike.set(row.leg.strike, entry);
  }

  const columns = compact ? 2 : 8;
  // Compact mode has 5 data columns (2 + strike + 2) against full mode's 17
  // (8 + strike + 8) — it needs a far smaller minimum width to actually fit
  // a 360-412px phone instead of forcing the same wide horizontal scroll.
  const cellPad = compact ? "px-2" : "px-3";

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setCompact((value) => !value)}
          className="h-11 rounded-full border border-border px-3 text-xs text-text-muted hover:border-accent hover:text-text"
        >
          {compact ? "Show all columns" : "Compact view"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className={`w-full text-sm ${compact ? "min-w-[380px]" : "min-w-[760px]"}`}>
          <thead>
            <tr className="border-b border-border bg-surface-raised/40 text-xs text-text-faint">
              <th colSpan={columns} className={`${cellPad} py-2 text-center font-semibold uppercase tracking-wide text-up`}>
                Calls
              </th>
              <th className={`${cellPad} py-2 text-center font-normal`}>Strike</th>
              <th colSpan={columns} className={`${cellPad} py-2 text-center font-semibold uppercase tracking-wide text-down`}>
                Puts
              </th>
            </tr>
            <tr className="border-b border-border bg-surface-raised/40 text-xs text-text-faint">
              {sideHeaders(compact, "CE")}
              <th className={`${cellPad} py-2 font-normal`} />
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
                  className={`border-t border-border transition-colors hover:bg-surface-raised/30 ${
                    isAtm ? "bg-accent/10 hover:bg-accent/15" : ""
                  }`}
                >
                  {sideCells(entry.CE, compact, "CE", atmStrike, strike, maxLegOi)}
                  <td
                    className={`${cellPad} py-2 text-center font-medium ${
                      isAtm ? "text-accent-strong" : "text-text"
                    }`}
                  >
                    {strike.toLocaleString("en-IN")}
                  </td>
                  {sideCells(entry.PE, compact, "PE", atmStrike, strike, maxLegOi)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const FULL_LABELS = ["OI", "ΔOI", "Vol", "IV", "Δ", "Bid", "Ask", "LTP"];

function sideHeaders(compact: boolean, side: "CE" | "PE") {
  const labels = compact ? ["OI", "LTP"] : FULL_LABELS;
  const ordered = side === "CE" ? labels : [...labels].reverse();
  const cellPad = compact ? "px-2" : "px-3";
  return ordered.map((label) => (
    <th key={`${side}-${label}`} className={`${cellPad} py-2 text-right font-normal`}>
      {label}
    </th>
  ));
}

type Cell = { text: string; oiFraction?: number; tone?: "up" | "down" };

function sideCells(
  row: Row | undefined,
  compact: boolean,
  side: "CE" | "PE",
  atmStrike: number | null,
  strike: number,
  maxLegOi: number | null
) {
  const leg = row?.leg;
  const est = row?.estimated;

  // In-the-money legs get a tinted background, the standard chain convention.
  const itm = atmStrike !== null && (side === "CE" ? strike < atmStrike : strike > atmStrike);

  const oiCell: Cell = {
    text: num(leg?.oi),
    oiFraction:
      leg?.oi != null && maxLegOi != null && maxLegOi > 0
        ? Math.min(1, leg.oi / maxLegOi)
        : undefined,
  };

  const delta =
    leg?.delta != null ? String(leg.delta) : est ? `${est.delta} est.` : "—";

  const cells: Cell[] = compact
    ? [oiCell, { text: num(leg?.ltp) }]
    : [
        oiCell,
        {
          text: num(leg?.changeOi),
          tone: leg?.changeOi == null ? undefined : leg.changeOi >= 0 ? "up" : "down",
        },
        { text: num(leg?.volume) },
        { text: num(leg?.iv) },
        { text: delta },
        { text: num(leg?.bid) },
        { text: num(leg?.ask) },
        { text: num(leg?.ltp) },
      ];

  const ordered = side === "CE" ? cells : [...cells].reverse();
  const cellPad = compact ? "px-2" : "px-3";

  return ordered.map((cell, index) => (
    <td
      key={`${side}-${index}`}
      className={`relative ${cellPad} py-2 text-right ${itm ? "bg-surface-raised" : ""}`}
    >
      {cell.oiFraction !== undefined ? (
        <span
          aria-hidden
          className={`absolute inset-y-0 ${side === "CE" ? "right-0" : "left-0"} bg-accent/15`}
          style={{ width: `${cell.oiFraction * 100}%` }}
        />
      ) : null}
      <span
        className={`relative ${
          cell.tone === "up" ? "text-up" : cell.tone === "down" ? "text-down" : "text-text"
        }`}
      >
        {cell.text}
      </span>
    </td>
  ));
}

function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-IN");
}
