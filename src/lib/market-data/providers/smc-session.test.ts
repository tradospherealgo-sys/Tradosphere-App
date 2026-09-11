import { describe, expect, it } from "vitest";
import { generateTotp } from "./smc-session";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Test-only encoder, used to turn the RFC 6238 Appendix B ASCII seed into
 * the base32 form generateTotp expects, so the assertions below are checked
 * against the RFC's own published test vectors rather than self-referential
 * values. */
function base32Encode(input: string): string {
  const bytes = Buffer.from(input, "ascii");
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    out += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}

describe("generateTotp", () => {
  // RFC 6238 Appendix B, SHA1 seed "12345678901234567890", 8-digit codes.
  const seed = base32Encode("12345678901234567890");

  it("matches the RFC 6238 vector at T=59s (T=0000000000000001)", () => {
    expect(generateTotp(seed, { digits: 8, timestamp: 59 * 1000 })).toBe("94287082");
  });

  it("matches the RFC 6238 vector at T=1111111109s (T=00000000023523EC)", () => {
    expect(generateTotp(seed, { digits: 8, timestamp: 1111111109 * 1000 })).toBe("07081804");
  });

  it("matches the RFC 6238 vector at T=1111111111s (T=00000000023523ED)", () => {
    expect(generateTotp(seed, { digits: 8, timestamp: 1111111111 * 1000 })).toBe("14050471");
  });

  it("produces a zero-padded 6-digit code by default", () => {
    const code = generateTotp(seed);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("changes every 30-second step", () => {
    const a = generateTotp(seed, { timestamp: 0 });
    const b = generateTotp(seed, { timestamp: 30_000 });
    expect(a).not.toBe(b);
  });

  it("is stable within the same 30-second step", () => {
    const a = generateTotp(seed, { timestamp: 1_000 });
    const b = generateTotp(seed, { timestamp: 29_000 });
    expect(a).toBe(b);
  });
});
