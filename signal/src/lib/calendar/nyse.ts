/**
 * NYSE trading calendar.
 *
 * Rule-based holiday/early-close generator (NYSE Rule 7.2 conventions) plus an explicit list of
 * unscheduled closures. Verified in tests against the NYSE holiday list for 2025–2027 as published
 * by the exchange (retrieved through the FMP market-hours endpoint at build time).
 *
 * Sessions (America/New_York): pre-market 04:00–09:30, regular 09:30–16:00 (13:00 on early-close
 * days), post-market until 20:00 (17:00 on early-close days).
 */
import { addDaysToKey, dateKeyOf, minutesSinceMidnight, weekdayOfKey, zonedToUtc } from "./time";

export type SessionState = "pre_market" | "regular" | "post_market" | "closed";

export interface Holiday {
  date: string;
  name: string;
}

/** Unscheduled full-day closures that no rule can derive. */
export const SPECIAL_CLOSURES: Holiday[] = [
  { date: "2001-09-11", name: "September 11 attacks" },
  { date: "2001-09-12", name: "September 11 attacks" },
  { date: "2001-09-13", name: "September 11 attacks" },
  { date: "2001-09-14", name: "September 11 attacks" },
  { date: "2004-06-11", name: "National Day of Mourning (Reagan)" },
  { date: "2007-01-02", name: "National Day of Mourning (Ford)" },
  { date: "2012-10-29", name: "Hurricane Sandy" },
  { date: "2012-10-30", name: "Hurricane Sandy" },
  { date: "2018-12-05", name: "National Day of Mourning (G.H.W. Bush)" },
  { date: "2025-01-09", name: "National Day of Mourning (Carter)" },
];

const key = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function nthWeekday(y: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return key(y, month, day);
}

function lastWeekday(y: number, month: number, weekday: number): string {
  const lastDay = new Date(Date.UTC(y, month, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(y, month - 1, lastDay)).getUTCDay();
  return key(y, month, lastDay - ((lastDow - weekday + 7) % 7));
}

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return key(y, month, day);
}

/** Saturday → Friday, Sunday → Monday. */
function observed(dateKey: string): string {
  const dow = weekdayOfKey(dateKey);
  if (dow === 6) return addDaysToKey(dateKey, -1);
  if (dow === 0) return addDaysToKey(dateKey, 1);
  return dateKey;
}

const holidayCache = new Map<number, Holiday[]>();

export function holidaysForYear(y: number): Holiday[] {
  const cached = holidayCache.get(y);
  if (cached) return cached;
  const list: Holiday[] = [];
  // New Year's Day: Sunday → Monday; Saturday is NOT observed on the prior Friday (Rule 7.2).
  const ny = key(y, 1, 1);
  const nyDow = weekdayOfKey(ny);
  if (nyDow === 0) list.push({ date: key(y, 1, 2), name: "New Year's Day (observed)" });
  else if (nyDow !== 6) list.push({ date: ny, name: "New Year's Day" });
  if (y >= 1998) list.push({ date: nthWeekday(y, 1, 1, 3), name: "Martin Luther King, Jr. Day" });
  list.push({ date: nthWeekday(y, 2, 1, 3), name: "Washington's Birthday" });
  list.push({ date: addDaysToKey(easterSunday(y), -2), name: "Good Friday" });
  list.push({ date: lastWeekday(y, 5, 1), name: "Memorial Day" });
  if (y >= 2022) list.push({ date: observed(key(y, 6, 19)), name: "Juneteenth" });
  list.push({ date: observed(key(y, 7, 4)), name: "Independence Day" });
  list.push({ date: nthWeekday(y, 9, 1, 1), name: "Labor Day" });
  list.push({ date: nthWeekday(y, 11, 4, 4), name: "Thanksgiving Day" });
  list.push({ date: observed(key(y, 12, 25)), name: "Christmas Day" });
  for (const s of SPECIAL_CLOSURES) if (s.date.startsWith(`${y}-`)) list.push(s);
  list.sort((a, b) => a.date.localeCompare(b.date));
  holidayCache.set(y, list);
  return list;
}

export function holidayOn(dateKey: string): Holiday | null {
  const y = Number(dateKey.slice(0, 4));
  return holidaysForYear(y).find((h) => h.date === dateKey) ?? null;
}

/** 13:00 ET early closes: Jul 3 (Mon–Thu), day after Thanksgiving, Dec 24 (Mon–Thu). */
export function earlyCloseOn(dateKey: string): string | null {
  const y = Number(dateKey.slice(0, 4));
  const jul3 = key(y, 7, 3);
  const jul3Dow = weekdayOfKey(jul3);
  if (dateKey === jul3 && jul3Dow >= 1 && jul3Dow <= 4) return "Independence Day early close";
  if (dateKey === addDaysToKey(nthWeekday(y, 11, 4, 4), 1)) return "Day after Thanksgiving early close";
  const dec24 = key(y, 12, 24);
  const dec24Dow = weekdayOfKey(dec24);
  if (dateKey === dec24 && dec24Dow >= 1 && dec24Dow <= 4) return "Christmas Eve early close";
  return null;
}

export function isTradingDay(dateKey: string): boolean {
  const dow = weekdayOfKey(dateKey);
  if (dow === 0 || dow === 6) return false;
  return holidayOn(dateKey) === null;
}

export interface Session {
  date: string;
  open: Date;
  close: Date;
  earlyClose: boolean;
  /** Regular-session length in minutes. */
  minutes: number;
}

const sessionCache = new Map<string, Session | null>();

export function sessionOn(dateKey: string): Session | null {
  if (sessionCache.has(dateKey)) return sessionCache.get(dateKey)!;
  let s: Session | null = null;
  if (isTradingDay(dateKey)) {
    const early = earlyCloseOn(dateKey) !== null;
    const open = zonedToUtc(dateKey, 9, 30);
    const close = zonedToUtc(dateKey, early ? 13 : 16, 0);
    s = { date: dateKey, open, close, earlyClose: early, minutes: (close.getTime() - open.getTime()) / 60000 };
  }
  sessionCache.set(dateKey, s);
  return s;
}

export function nextTradingDay(dateKey: string): string {
  let d = addDaysToKey(dateKey, 1);
  for (let i = 0; i < 15 && !isTradingDay(d); i++) d = addDaysToKey(d, 1);
  return d;
}

export function previousTradingDay(dateKey: string): string {
  let d = addDaysToKey(dateKey, -1);
  for (let i = 0; i < 15 && !isTradingDay(d); i++) d = addDaysToKey(d, -1);
  return d;
}

export function sessionState(at: Date): SessionState {
  const dk = dateKeyOf(at);
  const s = sessionOn(dk);
  if (!s) return "closed";
  const mins = minutesSinceMidnight(at);
  const closeMins = s.earlyClose ? 13 * 60 : 16 * 60;
  const postEnd = s.earlyClose ? 17 * 60 : 20 * 60;
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return "pre_market";
  if (mins >= 9 * 60 + 30 && mins < closeMins) return "regular";
  if (mins >= closeMins && mins < postEnd) return "post_market";
  return "closed";
}

/** The first regular session whose close is strictly after `at` ("day 0" for an event). */
export function dayZeroSession(at: Date): Session {
  let dk = dateKeyOf(at);
  let s = sessionOn(dk);
  if (s && at.getTime() < s.close.getTime()) return s;
  for (let i = 0; i < 15; i++) {
    dk = nextTradingDay(dk);
    s = sessionOn(dk);
    if (s) return s;
  }
  throw new Error(`No trading session found after ${at.toISOString()}`);
}

/** The most recent regular-session close at or before `at`. */
export function lastCloseAtOrBefore(at: Date): Session {
  let dk = dateKeyOf(at);
  let s = sessionOn(dk);
  if (s && s.close.getTime() <= at.getTime()) return s;
  for (let i = 0; i < 15; i++) {
    dk = previousTradingDay(dk);
    s = sessionOn(dk);
    if (s) return s;
  }
  throw new Error(`No trading session found before ${at.toISOString()}`);
}

/** Advance `minutes` of regular-session time from `at` (time outside sessions does not count). */
export function addTradingMinutes(at: Date, minutes: number): Date {
  let remaining = minutes;
  let s = dayZeroSession(at);
  let cursor = Math.max(at.getTime(), s.open.getTime());
  for (let i = 0; i < 30; i++) {
    const avail = (s.close.getTime() - cursor) / 60000;
    if (avail >= remaining) return new Date(cursor + remaining * 60000);
    remaining -= avail;
    s = sessionOn(nextTradingDay(s.date))!;
    cursor = s.open.getTime();
  }
  throw new Error("addTradingMinutes exceeded search window");
}

/** The close of the n-th session counting the day-0 session as 1. */
export function nthSessionClose(at: Date, n: number): Session {
  let s = dayZeroSession(at);
  for (let i = 1; i < n; i++) s = sessionOn(nextTradingDay(s.date))!;
  return s;
}

export function tradingDaysBetween(fromKey: string, toKey: string): number {
  let n = 0;
  let d = fromKey;
  while (d < toKey) {
    d = addDaysToKey(d, 1);
    if (isTradingDay(d)) n++;
  }
  return n;
}

export interface MarketClock {
  at: string;
  state: SessionState;
  dateKey: string;
  holiday: Holiday | null;
  earlyClose: string | null;
  nextOpen: string;
  nextClose: string;
}

export function marketClock(at: Date): MarketClock {
  const dk = dateKeyOf(at);
  const state = sessionState(at);
  const today = sessionOn(dk);
  let nextOpen: Date;
  if (today && at.getTime() < today.open.getTime()) nextOpen = today.open;
  else nextOpen = sessionOn(nextTradingDay(dk))!.open;
  const d0 = dayZeroSession(at);
  return {
    at: at.toISOString(),
    state,
    dateKey: dk,
    holiday: holidayOn(dk),
    earlyClose: earlyCloseOn(dk),
    nextOpen: nextOpen.toISOString(),
    nextClose: d0.close.toISOString(),
  };
}
