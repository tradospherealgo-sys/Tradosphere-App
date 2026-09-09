import { describe, expect, it } from "vitest";
import { getMarketStatus, quoteTtlMs } from "./market-hours";

/** Helper: build a UTC instant for a given IST wall-clock time. */
function ist(date: string, hh: number, mm: number): Date {
  return new Date(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`);
}

describe("getMarketStatus", () => {
  // 2026-09-09 is a Wednesday and not on the published holiday list.
  it("reports OPEN inside the 09:15–15:30 IST session", () => {
    const status = getMarketStatus(ist("2026-09-09", 11, 0));
    expect(status.phase).toBe("OPEN");
    expect(status.isOpen).toBe(true);
    expect(status.nextOpen).toBeNull();
  });

  it("treats the open and close instants as inclusive/exclusive respectively", () => {
    expect(getMarketStatus(ist("2026-09-09", 9, 15)).phase).toBe("OPEN");
    expect(getMarketStatus(ist("2026-09-09", 15, 29)).phase).toBe("OPEN");
    // 15:30 is the close — the session is over at that instant, not still on.
    expect(getMarketStatus(ist("2026-09-09", 15, 30)).phase).toBe("CLOSED");
  });

  it("reports PRE_OPEN between 09:00 and 09:15 IST", () => {
    const status = getMarketStatus(ist("2026-09-09", 9, 5));
    expect(status.phase).toBe("PRE_OPEN");
    expect(status.isOpen).toBe(false);
  });

  it("reports WEEKEND on Saturday and Sunday", () => {
    expect(getMarketStatus(ist("2026-09-12", 11, 0)).phase).toBe("WEEKEND");
    expect(getMarketStatus(ist("2026-09-13", 11, 0)).phase).toBe("WEEKEND");
  });

  it("reports HOLIDAY on a published NSE trading holiday", () => {
    // 2026-01-26 (Republic Day) falls on a Monday.
    const status = getMarketStatus(ist("2026-01-26", 11, 0));
    expect(status.phase).toBe("HOLIDAY");
    expect(status.isOpen).toBe(false);
  });

  it("is timezone-independent: the same instant classifies identically", () => {
    // 05:30 UTC == 11:00 IST, expressed two ways.
    const viaUtc = getMarketStatus(new Date("2026-09-09T05:30:00.000Z"));
    const viaIst = getMarketStatus(ist("2026-09-09", 11, 0));
    expect(viaUtc.phase).toBe(viaIst.phase);
    expect(viaUtc.phase).toBe("OPEN");
  });

  describe("nextOpen", () => {
    it("points at today's 09:15 when the session has not started", () => {
      const status = getMarketStatus(ist("2026-09-09", 7, 0));
      expect(status.nextOpen).toBe(ist("2026-09-09", 9, 15).toISOString());
    });

    it("skips the weekend from a Friday evening", () => {
      // 2026-09-11 is a Friday; the next open is Monday the 14th.
      const status = getMarketStatus(ist("2026-09-11", 17, 0));
      expect(status.nextOpen).toBe(ist("2026-09-14", 9, 15).toISOString());
    });

    it("skips a holiday that falls on a weekday", () => {
      // 2026-01-26 is a Monday holiday, so Friday evening rolls to Tuesday.
      const status = getMarketStatus(ist("2026-01-23", 17, 0));
      expect(status.nextOpen).toBe(ist("2026-01-27", 9, 15).toISOString());
    });
  });
});

describe("quoteTtlMs", () => {
  it("caches briefly while the session is live", () => {
    expect(quoteTtlMs(ist("2026-09-09", 11, 0))).toBe(5_000);
  });

  it("caches for longer when the market is closed, since the LTP cannot move", () => {
    expect(quoteTtlMs(ist("2026-09-12", 11, 0))).toBe(5 * 60_000);
  });
});
