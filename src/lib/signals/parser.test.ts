import { describe, expect, it } from "vitest";
import { parseSignalMessage } from "./parser";

function ok(msg: string) {
  const res = parseSignalMessage(msg);
  if (!res.ok) throw new Error(`expected parse to succeed: ${res.reason}`);
  return res.signal;
}

describe("parseSignalMessage", () => {
  it("reads a plain equity call", () => {
    const s = ok("BUY RELIANCE ABOVE 2450 SL 2400 TGT 2500 2550");
    expect(s.symbol).toBe("RELIANCE");
    expect(s.direction).toBe("BUY");
    expect(s.instrumentKind).toBe("EQUITY");
    expect(s.entryPrice).toBe(2450);
    expect(s.stopLoss).toBe(2400);
    expect(s.target1).toBe(2500);
    expect(s.target2).toBe(2550);
    expect(s.target3).toBeNull();
  });

  it("reads an entry range without inventing a single price", () => {
    const s = ok("SELL HDFCBANK ENTRY 1650-1660 SL 1690 TARGET 1600");
    expect(s.direction).toBe("SELL");
    expect(s.entryPrice).toBeNull();
    expect(s.entryLow).toBe(1650);
    expect(s.entryHigh).toBe(1660);
  });

  it("reads numbered targets", () => {
    const s = ok("BUY INFY CMP 1500 SL 1470 T1 1530 T2 1560 T3 1600");
    expect(s.target1).toBe(1530);
    expect(s.target2).toBe(1560);
    expect(s.target3).toBe(1600);
  });

  it("leaves unpublished levels null rather than deriving them", () => {
    const s = ok("BUY TCS ABOVE 3900 SL 3850");
    expect(s.target1).toBeNull();
    expect(s.target2).toBeNull();
    expect(s.target3).toBeNull();
  });

  it("classifies an index option", () => {
    const s = ok("BUY NIFTY 24500 CE @ 120 SL 95 TGT 160");
    expect(s.instrumentKind).toBe("INDEX_OPTION");
    expect(s.entryPrice).toBe(120);
  });

  it("classifies a stock option", () => {
    const s = ok("BUY RELIANCE 2500 CE ENTRY 45 SL 35 TGT 60");
    expect(s.instrumentKind).toBe("STOCK_OPTION");
  });

  it("handles LONG/SHORT wording and comma separators", () => {
    const s = ok("LONG SBIN, CMP 820, Stoploss 805, Target 845");
    expect(s.direction).toBe("BUY");
    expect(s.symbol).toBe("SBIN");
    expect(s.stopLoss).toBe(805);
    expect(s.target1).toBe(845);
  });

  it("skips filler words when finding the symbol", () => {
    const s = ok("BUY CALL ON WIPRO ABOVE 250 SL 240");
    expect(s.symbol).toBe("WIPRO");
  });

  it("rejects chat with no direction", () => {
    const res = parseSignalMessage("Markets look strong today, watch the banks");
    expect(res.ok).toBe(false);
  });

  it("rejects a direction with no symbol", () => {
    const res = parseSignalMessage("BUY 2450 SL 2400");
    expect(res.ok).toBe(false);
  });

  it("rejects a call with neither entry nor stop", () => {
    const res = parseSignalMessage("BUY RELIANCE looks good for a swing");
    expect(res.ok).toBe(false);
  });

  it("rejects an empty message", () => {
    expect(parseSignalMessage("   ").ok).toBe(false);
  });

  it("treats an inverted range as no range, not a swapped one", () => {
    const s = ok("BUY ITC ENTRY 460-440 SL 430");
    expect(s.entryLow).toBeNull();
    expect(s.entryHigh).toBeNull();
  });
});
