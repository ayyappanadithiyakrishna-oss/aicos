/**
 * Time-zone helpers built on Intl only (no tz database bundled).
 * All storage is UTC; exchange-local (America/New_York) is derived for display and session logic.
 */

export const EXCHANGE_TZ = "America/New_York";

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsFormatterCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Fast path for America/New_York (US DST rules in force since 2007: second Sunday of March 02:00
 * local → first Sunday of November 02:00 local). Avoids Intl, which is slow in hot loops.
 * Verified against Intl in tests.
 */
const dstCache = new Map<number, [number, number]>();
function usDstBoundsUtc(year: number): [number, number] {
  let b = dstCache.get(year);
  if (!b) {
    const marFirst = new Date(Date.UTC(year, 2, 1)).getUTCDay();
    const marSecondSunday = 1 + ((7 - marFirst) % 7) + 7;
    const novFirst = new Date(Date.UTC(year, 10, 1)).getUTCDay();
    const novFirstSunday = 1 + ((7 - novFirst) % 7);
    b = [Date.UTC(year, 2, marSecondSunday, 7, 0), Date.UTC(year, 10, novFirstSunday, 6, 0)];
    dstCache.set(year, b);
  }
  return b;
}

function nyOffsetMinutes(ms: number): number {
  const y = new Date(ms).getUTCFullYear();
  const [start, end] = usDstBoundsUtc(y);
  return ms >= start && ms < end ? -240 : -300;
}

function fastNyParts(date: Date): ZonedParts {
  const local = new Date(date.getTime() + nyOffsetMinutes(date.getTime()) * 60000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    weekday: local.getUTCDay(),
  };
}

export function zonedParts(date: Date, tz: string = EXCHANGE_TZ): ZonedParts {
  if (tz === EXCHANGE_TZ && date.getUTCFullYear() >= 2008) return fastNyParts(date);
  return intlZonedParts(date, tz);
}

export function intlZonedParts(date: Date, tz: string = EXCHANGE_TZ): ZonedParts {
  const out: Partial<Record<string, string>> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? "Sun"] ?? 0,
  };
}

/** Offset (minutes) of tz relative to UTC at the given instant, e.g. -240 for EDT. */
export function tzOffsetMinutes(date: Date, tz: string = EXCHANGE_TZ): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Convert a wall-clock time in tz to the UTC instant. Handles DST by re-checking the offset. */
export function zonedToUtc(dateKey: string, hour: number, minute: number, tz: string = EXCHANGE_TZ): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, hour, minute, 0);
  let guess = new Date(wall - tzOffsetMinutes(new Date(wall), tz) * 60000);
  const off2 = tzOffsetMinutes(guess, tz);
  guess = new Date(wall - off2 * 60000);
  return guess;
}

export function dateKeyOf(date: Date, tz: string = EXCHANGE_TZ): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function weekdayOfKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function minutesSinceMidnight(date: Date, tz: string = EXCHANGE_TZ): number {
  const p = zonedParts(date, tz);
  return p.hour * 60 + p.minute + p.second / 60;
}
