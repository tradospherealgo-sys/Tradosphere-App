import { describe, expect, it } from "vitest";
import { fromProseBlocks, toProseBlocks } from "./prose";

describe("toProseBlocks", () => {
  it("splits on blank lines", () => {
    const blocks = toProseBlocks("First para.\n\nSecond para.");
    expect(blocks).toEqual([{ p: "First para." }, { p: "Second para." }]);
  });

  it("promotes the first line to a heading when content follows", () => {
    const blocks = toProseBlocks("Position sizing\nRisk a fixed fraction.");
    expect(blocks).toEqual([{ h: "Position sizing", p: "Risk a fixed fraction." }]);
  });

  it("leaves a lone line as a paragraph, not a dangling heading", () => {
    expect(toProseBlocks("Just one line.")).toEqual([{ p: "Just one line." }]);
  });

  it("joins multi-line bodies under one heading", () => {
    const blocks = toProseBlocks("Theta\nDecay accelerates.\nEspecially near expiry.");
    expect(blocks).toEqual([
      { h: "Theta", p: "Decay accelerates. Especially near expiry." },
    ]);
  });

  it("drops empty and whitespace-only blocks", () => {
    expect(toProseBlocks("\n\n   \n\nReal.\n\n\n")).toEqual([{ p: "Real." }]);
  });

  it("returns nothing for empty input", () => {
    expect(toProseBlocks("")).toEqual([]);
    expect(toProseBlocks("   \n  ")).toEqual([]);
  });
});

describe("fromProseBlocks", () => {
  it("round-trips through toProseBlocks", () => {
    const text = "Heading one\nBody one.\n\nStandalone paragraph.";
    expect(fromProseBlocks(toProseBlocks(text))).toBe(text);
  });

  it("skips blocks with no content", () => {
    expect(fromProseBlocks([{ p: "" }, { p: "Kept." }])).toBe("Kept.");
  });
});
