import { afterEach, describe, expect, it } from "vitest";
import {
  TEST_FIXTURE_ENV_VAR,
  TestFixtureProvider,
  testFixtureEnabled,
} from "./test-fixture";

/**
 * These assertions guard a safety property, not a feature: the fixture must
 * be inert unless a human explicitly armed it, and it must never answer for
 * a symbol nobody gave it a price for.
 */

const original = process.env[TEST_FIXTURE_ENV_VAR];

afterEach(() => {
  if (original === undefined) delete process.env[TEST_FIXTURE_ENV_VAR];
  else process.env[TEST_FIXTURE_ENV_VAR] = original;
});

function withEnv(value: string | undefined) {
  if (value === undefined) delete process.env[TEST_FIXTURE_ENV_VAR];
  else process.env[TEST_FIXTURE_ENV_VAR] = value;
  return new TestFixtureProvider();
}

describe("test fixture provider", () => {
  it("is disarmed when the env var is absent", () => {
    delete process.env[TEST_FIXTURE_ENV_VAR];
    expect(testFixtureEnabled()).toBe(false);
    expect(withEnv(undefined).isConfigured()).toBe(false);
  });

  it("is armed only when the env var holds usable prices", () => {
    expect(withEnv('{"TESTCO":1000}').isConfigured()).toBe(true);
    expect(withEnv("not json").isConfigured()).toBe(false);
    expect(withEnv("[]").isConfigured()).toBe(false);
  });

  it("quotes only the symbols it was given", async () => {
    const provider = withEnv('{"TESTCO":1000}');
    expect(await provider.getQuote("UNLISTED")).toBeNull();
    const quote = await provider.getQuote("testco");
    expect(quote?.lastPrice).toBe(1000);
    expect(quote?.source).toBe("test_fixture");
  });

  it("rejects non-numeric and non-positive prices rather than coercing them", () => {
    const provider = withEnv('{"A":"1000","B":0,"C":-5,"D":12}');
    expect(provider.isConfigured()).toBe(true);
    return Promise.all([
      expect(provider.getQuote("A")).resolves.toBeNull(),
      expect(provider.getQuote("B")).resolves.toBeNull(),
      expect(provider.getQuote("C")).resolves.toBeNull(),
      expect(provider.getQuote("D")).resolves.not.toBeNull(),
    ]);
  });

  it("returns no candles — a flat line is still a fabricated chart", async () => {
    const provider = withEnv('{"TESTCO":1000}');
    const candles = await provider.getHistoricalCandles(
      "TESTCO",
      "1d",
      new Date(0),
      new Date()
    );
    expect(candles).toEqual([]);
  });

  it("skips unknown symbols in a batch instead of padding the result", async () => {
    const provider = withEnv('{"TESTCO":1000}');
    const quotes = await provider.getQuotes(["TESTCO", "UNLISTED"]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].symbol).toBe("TESTCO");
  });
});
