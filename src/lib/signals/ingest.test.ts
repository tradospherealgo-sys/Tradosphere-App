import { describe, expect, it } from "vitest";
import { __testing } from "./ingest";

const { categoryForInstrument } = __testing;

describe("categoryForInstrument", () => {
  it("maps EQUITY to EQUITY", () => {
    expect(categoryForInstrument("EQUITY")).toBe("EQUITY");
  });

  it("maps every option shape the rule-based parser detects to F&O", () => {
    expect(categoryForInstrument("INDEX_OPTION")).toBe("F&O");
    expect(categoryForInstrument("STOCK_OPTION")).toBe("F&O");
  });
});
