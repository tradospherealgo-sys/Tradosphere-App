import { afterEach, describe, expect, it, vi } from "vitest";
import { UpstoxOptionChainProvider } from "./upstox";
import { __testing } from "./upstox";

const { mapLeg, toNumber, diffOrNull } = __testing;

// A symbol containing "|" is treated as an already-resolved instrument_key,
// so these tests never touch Supabase — they exercise the fetch/parse path.
const KEY = "NSE_INDEX|Nifty 50";

function withToken<T>(run: () => Promise<T>): Promise<T> {
  process.env.UPSTOX_OPT_ACCESS_TOKEN_TEST = "token-123";
  return run().finally(() => {
    delete process.env.UPSTOX_OPT_ACCESS_TOKEN_TEST;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UpstoxOptionChainProvider.isConfigured", () => {
  it("is unconfigured with no access-token env var set", () => {
    const provider = new UpstoxOptionChainProvider({}, "UPSTOX_ACCESS_TOKEN_TEST_UNSET");
    expect(provider.isConfigured()).toBe(false);
  });

  it("is configured once the named env var holds a token", () => {
    process.env.UPSTOX_OPT_ACCESS_TOKEN_TEST = "token-123";
    const provider = new UpstoxOptionChainProvider({}, "UPSTOX_OPT_ACCESS_TOKEN_TEST");
    expect(provider.isConfigured()).toBe(true);
    delete process.env.UPSTOX_OPT_ACCESS_TOKEN_TEST;
  });

  it("defaults the env var name to UPSTOX_ACCESS_TOKEN when none is given", () => {
    process.env.UPSTOX_ACCESS_TOKEN = "token-abc";
    const provider = new UpstoxOptionChainProvider({}, null);
    expect(provider.isConfigured()).toBe(true);
    delete process.env.UPSTOX_ACCESS_TOKEN;
  });
});

describe("mapLeg", () => {
  it("maps a real-shaped v2 option/chain call_options entry to an OptionLeg", () => {
    const source = {
      instrument_key: "NSE_FO|44397",
      market_data: {
        ltp: 350.15,
        volume: 189525,
        oi: 1074975,
        close_price: 291.85,
        bid_price: 349.7,
        bid_qty: 1050,
        ask_price: 351.45,
        ask_qty: 75,
        prev_oi: 1050225,
      },
      option_greeks: {
        vega: 5.9587,
        theta: -17.6045,
        gamma: 0.0016,
        delta: 0.5501,
        iv: 12.55,
        pop: 54.63,
      },
    };

    const leg = mapLeg(23500, "CE", source);

    expect(leg).toEqual({
      strike: 23500,
      optionType: "CE",
      ltp: 350.15,
      bid: 349.7,
      ask: 351.45,
      volume: 189525,
      oi: 1074975,
      changeOi: 1074975 - 1050225,
      iv: 12.55,
      delta: 0.5501,
      gamma: 0.0016,
      theta: -17.6045,
      vega: 5.9587,
    });
  });

  it("tolerates missing market_data/option_greeks without fabricating values", () => {
    const leg = mapLeg(23500, "PE", {});
    expect(leg.ltp).toBeNull();
    expect(leg.oi).toBeNull();
    expect(leg.changeOi).toBeNull();
    expect(leg.iv).toBeNull();
    expect(leg.delta).toBeNull();
  });
});

describe("toNumber", () => {
  it("passes through finite numbers", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0)).toBe(0);
  });

  it("parses numeric strings", () => {
    expect(toNumber("42.5")).toBe(42.5);
  });

  it("rejects non-numeric and non-finite values", () => {
    expect(toNumber("not a number")).toBeNull();
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });
});

describe("diffOrNull", () => {
  it("computes the difference when both values are present", () => {
    expect(diffOrNull(1074975, 1050225)).toBe(24750);
  });

  it("returns null when either side is missing rather than guessing a delta", () => {
    expect(diffOrNull(null, 1050225)).toBeNull();
    expect(diffOrNull(1074975, null)).toBeNull();
    expect(diffOrNull(null, null)).toBeNull();
  });
});

describe("UpstoxOptionChainProvider.getChain", () => {
  it("returns null when unconfigured (no token) without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new UpstoxOptionChainProvider({}, "UPSTOX_OPT_ACCESS_TOKEN_TEST_UNSET");
    expect(await provider.getChain(KEY, "2025-01-30")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps calls and puts on a real-shaped success response", () =>
    withToken(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [
              {
                strike_price: 23500,
                underlying_spot_price: 23480,
                call_options: { market_data: { ltp: 150 }, option_greeks: { delta: 0.5 } },
                put_options: { market_data: { ltp: 90 }, option_greeks: { delta: -0.5 } },
              },
            ],
          }),
        })
      );
      const provider = new UpstoxOptionChainProvider({}, "UPSTOX_OPT_ACCESS_TOKEN_TEST");
      const snapshot = await provider.getChain(KEY, "2025-01-30");
      expect(snapshot).not.toBeNull();
      expect(snapshot?.legs).toHaveLength(2);
      expect(snapshot?.spotAtCapture).toBe(23480);
    }));

  it("returns null on an empty chain rather than a fabricated snapshot", () =>
    withToken(async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }));
      const provider = new UpstoxOptionChainProvider({}, "UPSTOX_OPT_ACCESS_TOKEN_TEST");
      expect(await provider.getChain(KEY, "2025-01-30")).toBeNull();
    }));

  it("returns null rather than throwing on an Upstox API error", () =>
    withToken(async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      const provider = new UpstoxOptionChainProvider({}, "UPSTOX_OPT_ACCESS_TOKEN_TEST");
      expect(await provider.getChain(KEY, "2025-01-30")).toBeNull();
    }));

  it("returns null when Upstox rejects the token with 401 during the contract lookup", () =>
    withToken(async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
      const provider = new UpstoxOptionChainProvider({}, "UPSTOX_OPT_ACCESS_TOKEN_TEST");
      // No explicit expiry -> falls back to getExpiries(), which also 401s -> [].
      expect(await provider.getChain(KEY)).toBeNull();
    }));
});

describe("UpstoxOptionChainProvider.testConnection", () => {
  it("distinguishes an expired/invalid token (401) from other failures", () =>
    withToken(async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
      const provider = new UpstoxOptionChainProvider({}, "UPSTOX_OPT_ACCESS_TOKEN_TEST");
      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/401/);
    }));
});
