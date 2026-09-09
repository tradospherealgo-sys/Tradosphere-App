import { describe, expect, it } from "vitest";
import { analyseChain } from "./analysis";
import type { OptionChainSnapshot, OptionLeg } from "./types";

function leg(
  strike: number,
  optionType: "CE" | "PE",
  overrides: Partial<OptionLeg> = {}
): OptionLeg {
  return {
    strike,
    optionType,
    ltp: 10,
    bid: 9.5,
    ask: 10.5,
    volume: 100,
    oi: 1000,
    changeOi: 0,
    iv: 14,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    ...overrides,
  };
}

function snapshot(legs: OptionLeg[], spot: number | null = 20_000): OptionChainSnapshot {
  return {
    underlying: "NIFTY",
    expiry: "2026-09-24",
    spotAtCapture: spot,
    capturedAt: "2026-09-09T09:30:00.000Z",
    source: "test",
    legs,
  };
}

describe("analyseChain", () => {
  it("returns nulls throughout for an empty chain rather than zeroes", () => {
    const analysis = analyseChain(snapshot([]));
    expect(analysis.pcr).toBeNull();
    expect(analysis.volumePcr).toBeNull();
    expect(analysis.maxPain).toBeNull();
    expect(analysis.totalCallOi).toBeNull();
    expect(analysis.totalPutOi).toBeNull();
    expect(analysis.maxCallOiStrike).toBeNull();
    expect(analysis.maxPutOiStrike).toBeNull();
    expect(analysis.maxLegOi).toBeNull();
    expect(analysis.strikeCount).toBe(0);
    expect(analysis.topOiBuildup).toEqual([]);
  });

  it("aggregates OI and volume by side", () => {
    const analysis = analyseChain(
      snapshot([
        leg(19_900, "CE", { oi: 500, volume: 10 }),
        leg(20_000, "CE", { oi: 1_500, volume: 20 }),
        leg(19_900, "PE", { oi: 800, volume: 30 }),
        leg(20_000, "PE", { oi: 1_200, volume: 40 }),
      ])
    );
    expect(analysis.totalCallOi).toBe(2_000);
    expect(analysis.totalPutOi).toBe(2_000);
    expect(analysis.totalCallVolume).toBe(30);
    expect(analysis.totalPutVolume).toBe(70);
    expect(analysis.pcr).toBe(1);
    expect(analysis.volumePcr).toBeCloseTo(70 / 30, 4);
    expect(analysis.strikeCount).toBe(2);
  });

  it("treats a side with no published OI as unknown, not zero", () => {
    const analysis = analyseChain(
      snapshot([
        leg(20_000, "CE", { oi: null }),
        leg(20_000, "PE", { oi: 1_000 }),
      ])
    );
    expect(analysis.totalCallOi).toBeNull();
    expect(analysis.totalPutOi).toBe(1_000);
    expect(analysis.pcr).toBeNull();
  });

  it("identifies the peak-OI strike on each side", () => {
    const analysis = analyseChain(
      snapshot([
        leg(20_200, "CE", { oi: 9_000, changeOi: 300 }),
        leg(20_100, "CE", { oi: 4_000 }),
        leg(19_800, "PE", { oi: 7_500, changeOi: -200 }),
        leg(19_900, "PE", { oi: 2_000 }),
      ])
    );
    expect(analysis.maxCallOiStrike).toEqual({ strike: 20_200, oi: 9_000, changeOi: 300 });
    expect(analysis.maxPutOiStrike).toEqual({ strike: 19_800, oi: 7_500, changeOi: -200 });
    expect(analysis.maxLegOi).toBe(9_000);
  });

  it("ranks OI build-up by magnitude, so unwinding is as visible as writing", () => {
    const analysis = analyseChain(
      snapshot([
        leg(20_000, "CE", { changeOi: 100 }),
        leg(20_100, "CE", { changeOi: -900 }),
        leg(19_900, "PE", { changeOi: 400 }),
      ])
    );
    expect(analysis.topOiBuildup.map((b) => b.strike)).toEqual([20_100, 19_900, 20_000]);
    expect(analysis.topOiBuildup[0].optionType).toBe("CE");
  });

  it("caps the build-up list at five entries", () => {
    const legs = Array.from({ length: 12 }, (_, i) =>
      leg(20_000 + i * 100, "CE", { changeOi: i * 10 })
    );
    expect(analyseChain(snapshot(legs)).topOiBuildup).toHaveLength(5);
  });

  it("nets change in OI as puts minus calls", () => {
    const analysis = analyseChain(
      snapshot([
        leg(20_000, "CE", { changeOi: 200 }),
        leg(20_000, "PE", { changeOi: 900 }),
      ])
    );
    expect(analysis.netChangeOi).toBe(700);
  });

  it("cannot locate ATM without a spot price", () => {
    const analysis = analyseChain(snapshot([leg(20_000, "CE")], null));
    expect(analysis.atmStrike).toBeNull();
  });

  it("locates ATM as the strike nearest the captured spot", () => {
    const analysis = analyseChain(
      snapshot([leg(19_800, "CE"), leg(20_000, "CE"), leg(20_200, "CE")], 19_960)
    );
    expect(analysis.atmStrike).toBe(20_000);
  });

  it("guards volume PCR against a zero-volume call side", () => {
    const analysis = analyseChain(
      snapshot([leg(20_000, "CE", { volume: 0 }), leg(20_000, "PE", { volume: 50 })])
    );
    expect(analysis.volumePcr).toBeNull();
  });
});
