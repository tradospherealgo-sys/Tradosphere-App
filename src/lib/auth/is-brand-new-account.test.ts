import { describe, expect, it } from "vitest";
import { isBrandNewAccount } from "./is-brand-new-account";

describe("isBrandNewAccount", () => {
  it("treats a user with no last_sign_in_at as brand new", () => {
    expect(isBrandNewAccount({ created_at: "2026-01-01T00:00:00Z", last_sign_in_at: null })).toBe(
      true
    );
  });

  it("treats a user missing last_sign_in_at entirely as brand new", () => {
    expect(isBrandNewAccount({ created_at: "2026-01-01T00:00:00Z" })).toBe(true);
  });

  it("treats created_at and last_sign_in_at within 10s of each other as brand new", () => {
    expect(
      isBrandNewAccount({
        created_at: "2026-01-01T00:00:00.000Z",
        last_sign_in_at: "2026-01-01T00:00:05.000Z",
      })
    ).toBe(true);
  });

  it("treats a sign-in long after account creation as a returning user", () => {
    expect(
      isBrandNewAccount({
        created_at: "2026-01-01T00:00:00Z",
        last_sign_in_at: "2026-02-01T00:00:00Z",
      })
    ).toBe(false);
  });

  it("is exactly at the 10s boundary exclusive (>= 10s is returning)", () => {
    expect(
      isBrandNewAccount({
        created_at: "2026-01-01T00:00:00.000Z",
        last_sign_in_at: "2026-01-01T00:00:10.000Z",
      })
    ).toBe(false);
  });

  it("handles last_sign_in_at before created_at (clock skew) as brand new", () => {
    expect(
      isBrandNewAccount({
        created_at: "2026-01-01T00:00:05.000Z",
        last_sign_in_at: "2026-01-01T00:00:00.000Z",
      })
    ).toBe(true);
  });
});
