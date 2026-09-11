import { describe, expect, it } from "vitest";
import { secretsMatch } from "./secrets";

describe("secretsMatch", () => {
  it("returns true for identical strings", () => {
    expect(secretsMatch("abc123", "abc123")).toBe(true);
  });

  it("returns false for a mismatched value", () => {
    expect(secretsMatch("abc124", "abc123")).toBe(false);
  });

  it("returns false when lengths differ", () => {
    expect(secretsMatch("abc", "abc123")).toBe(false);
  });

  it("returns false for null (missing header)", () => {
    expect(secretsMatch(null, "abc123")).toBe(false);
  });

  it("returns false for an empty presented value", () => {
    expect(secretsMatch("", "abc123")).toBe(false);
  });
});
