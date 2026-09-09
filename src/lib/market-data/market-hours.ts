/**
 * NSE session calendar.
 *
 * Pure date math over the published NSE trading calendar — no network, no
 * provider, no price data. Every surface that renders a quote uses this to
 * tell the user *why* a number is or isn't moving: a stale LTP during a
 * closed session is expected behaviour, whereas a stale LTP mid-session is a
 * feed problem. Conflating the two is what makes a data outage look like a
 * quiet market.
 *
 * Holidays are the NSE-published equity-segment trading holidays. They can be
 * overridden without a redeploy via NSE_TRADING_HOLIDAYS (comma-separated
 * YYYY-MM-DD), because the exchange publishes the next year's list annually
 * and occasionally adds an unscheduled closure.
 */

export type MarketPhase = "PRE_OPEN" | "OPEN" | "CLOSED" | "HOLIDAY" | "WEEKEND";

export type MarketStatus = {
  phase: MarketPhase;
  isOpen: boolean;
  /** IST wall-clock label, e.g. "09:15". */
  sessionOpen: string;
  sessionClose: string;
  /** ISO timestamp of the next open, or null when already open. */
  nextOpen: string | null;
  label: string;
};

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** Minutes past IST midnight. */
const PRE_OPEN_START = 9 * 60;
const SESSION_START = 9 * 60 + 15;
const SESSION_END = 15 * 60 + 30;

const PUBLISHED_HOLIDAYS = [
  // NSE equity-segment trading holidays, 2025.
  "2025-02-26", "2025-03-14", "2025-03-31", "2025-04-10", "2025-04-14",
  "2025-04-18", "2025-05-01", "2025-08-15", "2025-08-27", "2025-10-02",
  "2025-10-21", "2025-10-22", "2025-11-05", "2025-12-25",
  // 2026.
  "2026-01-26", "2026-02-15", "2026-03-04", "2026-03-21", "2026-03-26",
  "2026-04-01", "2026-04-03", "2026-04-14", "2026-05-01", "2026-08-15",
  "2026-08-26", "2026-10-02", "2026-10-20", "2026-11-09", "2026-12-25",
];

function holidaySet(): Set<string> {
  const override = process.env.NSE_TRADING_HOLIDAYS;
  if (!override) return new Set(PUBLISHED_HOLIDAYS);
  const parsed = override.split(",").map((d) => d.trim()).filter(Boolean);
  return new Set(parsed.length > 0 ? parsed : PUBLISHED_HOLIDAYS);
}

/** Calendar parts of `date` as observed in IST, independent of server TZ. */
function istParts(date: Date): { iso: string; weekday: number; minutes: number } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    iso: shifted.toISOString().slice(0, 10),
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** UTC instant for a given IST calendar date + minutes-past-midnight. */
function istInstant(isoDate: string, minutes: number): Date {
  return new Date(
    new Date(`${isoDate}T00:00:00.000Z`).getTime() + (minutes - IST_OFFSET_MINUTES) * 60_000
  );
}

function isTradingDay(iso: string, weekday: number, holidays: Set<string>): boolean {
  return weekday !== 0 && weekday !== 6 && !holidays.has(iso);
}

function nextOpenAfter(from: Date, holidays: Set<string>): string {
  const { iso, weekday, minutes } = istParts(from);

  // Today still has an unstarted session.
  if (isTradingDay(iso, weekday, holidays) && minutes < SESSION_START) {
    return istInstant(iso, SESSION_START).toISOString();
  }

  // Walk forward to the next trading day. The horizon is generous enough to
  // clear any run of holidays the exchange has ever published.
  for (let step = 1; step <= 14; step++) {
    const candidate = istParts(new Date(from.getTime() + step * 24 * 60 * 60_000));
    if (isTradingDay(candidate.iso, candidate.weekday, holidays)) {
      return istInstant(candidate.iso, SESSION_START).toISOString();
    }
  }
  return istInstant(iso, SESSION_START).toISOString();
}

export function getMarketStatus(now: Date = new Date()): MarketStatus {
  const holidays = holidaySet();
  const { iso, weekday, minutes } = istParts(now);

  const base = {
    sessionOpen: "09:15",
    sessionClose: "15:30",
  };

  if (weekday === 0 || weekday === 6) {
    return {
      ...base,
      phase: "WEEKEND",
      isOpen: false,
      nextOpen: nextOpenAfter(now, holidays),
      label: "Weekend — NSE is closed",
    };
  }

  if (holidays.has(iso)) {
    return {
      ...base,
      phase: "HOLIDAY",
      isOpen: false,
      nextOpen: nextOpenAfter(now, holidays),
      label: "Trading holiday — NSE is closed",
    };
  }

  if (minutes >= PRE_OPEN_START && minutes < SESSION_START) {
    return {
      ...base,
      phase: "PRE_OPEN",
      isOpen: false,
      nextOpen: istInstant(iso, SESSION_START).toISOString(),
      label: "Pre-open session (09:00–09:15 IST)",
    };
  }

  if (minutes >= SESSION_START && minutes < SESSION_END) {
    return {
      ...base,
      phase: "OPEN",
      isOpen: true,
      nextOpen: null,
      label: "Market open (09:15–15:30 IST)",
    };
  }

  return {
    ...base,
    phase: "CLOSED",
    isOpen: false,
    nextOpen: nextOpenAfter(now, holidays),
    label: minutes < PRE_OPEN_START ? "Pre-market — NSE opens at 09:15 IST" : "Market closed",
  };
}

/**
 * How long a quote may be cached. Outside the session the last traded price
 * cannot change, so a long TTL is correct rather than merely convenient —
 * it stops a closed market from generating pointless upstream load.
 */
export function quoteTtlMs(now: Date = new Date()): number {
  return getMarketStatus(now).isOpen ? 5_000 : 5 * 60_000;
}
