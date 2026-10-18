import { describe, expect, it } from "vitest";
import { earlyCloseOn, holidayOn, holidaysForYear, isTradingDay, sessionOn, sessionState, dayZeroSession, addTradingMinutes } from "@/lib/calendar/nyse";
import { horizonWindow } from "@/lib/calendar/horizons";
import { intlZonedParts, zonedParts, zonedToUtc } from "@/lib/calendar/time";

// NYSE schedule as published by the exchange (retrieved via the FMP market-hours endpoint).
const NYSE_CLOSED: Record<number, string[]> = {
  2025: ["2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25"],
  2026: ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"],
  2027: ["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"],
};
const NYSE_EARLY: Record<number, string[]> = {
  2025: ["2025-07-03", "2025-11-28", "2025-12-24"],
  2026: ["2026-11-27", "2026-12-24"],
  2027: ["2027-11-26"],
};

describe("NYSE calendar", () => {
  for (const y of [2025, 2026, 2027]) {
    it(`matches the published ${y} holiday list exactly`, () => {
      expect(holidaysForYear(y).map((h) => h.date)).toEqual(NYSE_CLOSED[y]);
    });
    it(`matches the published ${y} early closes`, () => {
      const all: string[] = [];
      for (let d = new Date(Date.UTC(y, 0, 1)); d.getUTCFullYear() === y; d.setUTCDate(d.getUTCDate() + 1)) {
        const k = d.toISOString().slice(0, 10);
        if (earlyCloseOn(k) && isTradingDay(k)) all.push(k);
      }
      expect(all).toEqual(NYSE_EARLY[y]);
    });
  }

  it("does not observe a Saturday New Year's Day on the prior Friday", () => {
    expect(isTradingDay("2021-12-31")).toBe(true);
    expect(holidayOn("2022-01-01")).toBeNull();
  });

  it("closes at 13:00 ET on early-close days", () => {
    const s = sessionOn("2026-11-27")!;
    expect(s.earlyClose).toBe(true);
    expect(s.close.toISOString()).toBe("2026-11-27T18:00:00.000Z");
    expect(sessionState(new Date("2026-11-27T18:30:00Z"))).toBe("post_market");
  });

  it("maps a Friday post-market publication to the next Monday close", () => {
    const w = horizonWindow(new Date("2026-10-09T20:30:00Z"), "next_session"); // Fri 16:30 ET
    expect(w.baselineRule).toBe("prior_regular_close");
    expect(w.start.toISOString()).toBe("2026-10-09T20:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-12T20:00:00.000Z"); // Mon 16:00 EDT
  });

  it("skips an exchange holiday when the next session falls on it", () => {
    // Friday 2026-01-16 after hours → Monday 2026-01-19 is MLK Day → Tuesday close.
    const w = horizonWindow(new Date("2026-01-16T22:00:00Z"), "next_session");
    expect(w.end.toISOString()).toBe("2026-01-20T21:00:00.000Z");
  });

  it("uses the same-day close for pre-market and intraday news", () => {
    expect(horizonWindow(new Date("2026-10-14T12:30:00Z"), "next_session").end.toISOString()).toBe("2026-10-14T20:00:00.000Z");
    const intraday = horizonWindow(new Date("2026-10-14T18:30:00Z"), "next_session");
    expect(intraday.baselineRule).toBe("intraday_last_trade");
    expect(intraday.end.toISOString()).toBe("2026-10-14T20:00:00.000Z");
  });

  it("counts 1 trading hour across the close into the next session", () => {
    const end = addTradingMinutes(new Date("2026-10-14T19:30:00Z"), 60); // 15:30 ET → 30m today + 30m tomorrow
    expect(end.toISOString()).toBe("2026-10-15T14:00:00.000Z");
  });

  it("5-session horizon counts day 0 as the first session and skips weekends", () => {
    const w = horizonWindow(new Date("2026-10-09T13:00:00Z"), "5_sessions"); // Fri pre-market
    expect(w.end.toISOString()).toBe("2026-10-15T20:00:00.000Z");
  });

  it("day-zero session after the close is the next trading day", () => {
    expect(dayZeroSession(new Date("2026-07-02T21:00:00Z")).date).toBe("2026-07-06"); // Jul 3 holiday, weekend
  });

  it("fast New York conversion agrees with Intl across DST transitions", () => {
    const start = Date.UTC(2024, 0, 1);
    for (let i = 0; i < 2000; i++) {
      const d = new Date(start + i * 37 * 3_600_000 + 13 * 60000);
      expect(zonedParts(d)).toEqual(intlZonedParts(d));
    }
    expect(zonedToUtc("2026-03-08", 9, 30).toISOString()).toBe("2026-03-08T13:30:00.000Z");
    expect(zonedToUtc("2026-11-02", 9, 30).toISOString()).toBe("2026-11-02T14:30:00.000Z");
  });
});
