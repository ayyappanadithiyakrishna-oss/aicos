import "server-only";
/**
 * London Strategic Edge vault API (https://londonstrategicedge.com/api-documentation).
 * One key (x-api-key) covers candles, fundamentals and the economic calendar.
 * Timestamps are UTC bar-open times; we re-stamp bars at their END so "available at t" holds.
 */
import type { PriceBar } from "@/lib/domain/types";
import { ProviderError, providerJson } from "./http";

const BASE = "https://api.londonstrategicedge.com/vault";
const RATE = 3.2; // 200 calls/min plan limit, kept well under

interface LseCandle {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface LseCalendarRow {
  datetime: string;
  region_code: string;
  event: string;
  period_hint: string | null;
  actual: string | null;
  previous: string | null;
  consensus: string | null;
  forecast: string | null;
}

const lseSymbol = (ticker: string) => ticker.toUpperCase();
const utc = (ts: string) => Date.parse(`${ts.replace(" ", "T").slice(0, 19)}Z`);

const nyParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
function ny(ms: number) {
  const p = Object.fromEntries(nyParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
/** 16:00 New York time on a calendar date, as a UTC instant. */
function nyCloseUtc(day: string) {
  const edt = Date.parse(`${day}T20:00:00Z`);
  return ny(edt).minutes === 16 * 60 ? edt : Date.parse(`${day}T21:00:00Z`);
}

async function candles(key: string, symbol: string, timeframe: "1d" | "30m", start: string, fetchImpl?: typeof fetch): Promise<LseCandle[]> {
  const url = `${BASE}/candles?symbol=${encodeURIComponent(lseSymbol(symbol))}&timeframe=${timeframe}&start=${start}&limit=5000`;
  const rows = await providerJson<LseCandle[] | { detail?: string }>(url, { provider: "lse", ratePerSec: RATE, headers: { "x-api-key": key }, revalidate: timeframe === "1d" ? 900 : 300, fetchImpl, attempts: 2 });
  if (!Array.isArray(rows)) throw new ProviderError("lse", "schema", `No candles for ${symbol}`);
  return rows;
}

export interface LseBars {
  daily: PriceBar[];
  intraday: PriceBar[];
}

/**
 * Daily bars for ~400 days plus 30-minute regular-session bars for the last month. The vault's
 * daily bars include extended hours, so the last month of daily bars is rebuilt from regular-session
 * 30-minute bars (09:30–16:00 ET) to match official closes.
 */
async function fetchBars(key: string, symbol: string, now: Date, fetchImpl?: typeof fetch): Promise<LseBars> {
  const dayStart = new Date(now.getTime() - 400 * 86_400_000).toISOString().slice(0, 10);
  const intraStart = new Date(now.getTime() - 31 * 86_400_000).toISOString().slice(0, 10);
  const [d, m] = await Promise.all([candles(key, symbol, "1d", dayStart, fetchImpl), candles(key, symbol, "30m", intraStart, fetchImpl).catch(() => [] as LseCandle[])]);

  const intraday: PriceBar[] = [];
  const sessions = new Map<string, PriceBar>();
  for (const b of m) {
    const open = utc(b.ts);
    const { day, minutes } = ny(open);
    if (minutes < 9 * 60 + 30 || minutes >= 16 * 60) continue;
    const end = open + 30 * 60_000;
    intraday.push({ t: new Date(end).toISOString(), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume ?? 0 });
    const s = sessions.get(day);
    if (!s) sessions.set(day, { t: new Date(nyCloseUtc(day)).toISOString(), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume ?? 0 });
    else {
      s.h = Math.max(s.h, b.high);
      s.l = Math.min(s.l, b.low);
      s.c = b.close;
      s.v += b.volume ?? 0;
    }
  }
  const daily: PriceBar[] = [];
  for (const b of d) {
    const day = b.ts.slice(0, 10);
    if (sessions.has(day)) continue;
    daily.push({ t: new Date(nyCloseUtc(day)).toISOString(), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume ?? 0 });
  }
  // A session still in progress has no close yet; keep only completed sessions in the daily series.
  for (const [day, s] of sessions) if (Date.parse(s.t) <= now.getTime() || day < ny(now.getTime()).day) daily.push(s);
  daily.sort((a, b) => a.t.localeCompare(b.t));
  return { daily, intraday: intraday.filter((b) => Date.parse(b.t) <= now.getTime()) };
}

const cache = new Map<string, { at: number; p: Promise<LseBars> }>();

/** Cached per instance (5 min) and de-duplicated while in flight. */
export function lseBars(key: string, symbol: string, now = new Date(), fetchImpl?: typeof fetch): Promise<LseBars> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.p;
  const p = fetchBars(key, symbol, now, fetchImpl);
  cache.set(symbol, { at: Date.now(), p });
  p.catch(() => cache.delete(symbol));
  return p;
}

let calCache: { at: number; p: Promise<LseCalendarRow[]> } | null = null;

/** US economic calendar from 45 days back to 30 days ahead (cached 10 min). */
export function lseUsCalendar(key: string, now = new Date(), fetchImpl?: typeof fetch): Promise<LseCalendarRow[]> {
  if (calCache && Date.now() - calCache.at < 10 * 60_000) return calCache.p;
  const start = new Date(now.getTime() - 45 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const p = providerJson<LseCalendarRow[]>(`${BASE}/ref/economic_calendar?region=US&start=${start}&end=${end}&limit=5000`, {
    provider: "lse",
    ratePerSec: RATE,
    headers: { "x-api-key": key },
    revalidate: 600,
    fetchImpl,
    attempts: 2,
  });
  calCache = { at: Date.now(), p };
  p.catch(() => (calCache = null));
  return p;
}

export const calendarAt = (r: LseCalendarRow) => new Date(utc(r.datetime)).toISOString();

/** "279.2B" → { value: 279.2, unit: "B" }; "4.2%" → { 4.2, "%" }; "54.5" → { 54.5, "index" }. */
export function parseFigure(s: string | null): { value: number; unit: string } | null {
  if (!s) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(%|K|M|B|T)?\s*$/i.exec(s);
  if (!m) return null;
  return { value: Number(m[1]), unit: (m[2] ?? "index").toUpperCase() };
}
