import "server-only";
/**
 * Options-implied move for an underlying from Massive end-of-day option bars (Basic plan):
 * nearest weekly/monthly expiry ≥ 3 calendar days out, ATM strike, previous-session call + put closes.
 * Three requests per underlying; cached 6 hours because closes change once per session.
 */
import { z } from "zod";
import { impliedMoveFromEodStraddle, type EodImpliedMove } from "@/lib/quant/options";
import { providerJson } from "./http";

const RATE = 5 / 60;
const Contracts = z.object({ results: z.array(z.object({ ticker: z.string(), expiration_date: z.string(), strike_price: z.number(), contract_type: z.string() })).optional() });
const Prev = z.object({ results: z.array(z.object({ c: z.number(), t: z.number() })).optional() });

function tradingDaysBetween(fromDate: string, toDate: string): number {
  let n = 0;
  const d = new Date(`${fromDate}T12:00:00Z`);
  const end = Date.parse(`${toDate}T12:00:00Z`);
  while (d.getTime() < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return Math.max(1, n);
}

const cache = new Map<string, { at: number; p: Promise<EodImpliedMove> }>();

export function massiveImpliedMove(apiKey: string, ticker: string, spot: { price: number; at: string }, now = new Date()): Promise<EodImpliedMove> {
  const key = ticker.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.p;
  const p = compute(apiKey, key, spot, now).catch((e): EodImpliedMove => ({ available: false, reason: e instanceof Error && /429|rate/i.test(e.message) ? "Options data rate-limited (5 requests/min); try again shortly." : "Options data unavailable for this underlying." }));
  cache.set(key, { at: Date.now(), p });
  return p;
}

async function compute(apiKey: string, ticker: string, spot: { price: number; at: string }, now: Date): Promise<EodImpliedMove> {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const q = new URLSearchParams({
    underlying_ticker: ticker.replace(".", ""),
    "expiration_date.gte": day(now.getTime() + 3 * 86_400_000),
    "expiration_date.lte": day(now.getTime() + 24 * 86_400_000),
    "strike_price.gte": (spot.price * 0.96).toFixed(2),
    "strike_price.lte": (spot.price * 1.04).toFixed(2),
    order: "asc",
    sort: "expiration_date",
    limit: "250",
    apiKey,
  });
  const c = Contracts.parse(await providerJson(`https://api.massive.com/v3/reference/options/contracts?${q}`, { provider: "massive", ratePerSec: RATE, revalidate: 21_600, attempts: 2 }));
  const rows = c.results ?? [];
  const expiry = rows[0]?.expiration_date;
  if (!expiry) return { available: false, reason: "No listed options near the money for this underlying." };
  const atExpiry = rows.filter((r) => r.expiration_date === expiry);
  const strikes = [...new Set(atExpiry.map((r) => r.strike_price))].filter((k) => atExpiry.some((r) => r.strike_price === k && r.contract_type === "call") && atExpiry.some((r) => r.strike_price === k && r.contract_type === "put"));
  const strike = strikes.sort((a, b) => Math.abs(a - spot.price) - Math.abs(b - spot.price))[0];
  if (strike === undefined) return { available: false, reason: "No matched call/put pair at the money." };
  const call = atExpiry.find((r) => r.strike_price === strike && r.contract_type === "call")!.ticker;
  const put = atExpiry.find((r) => r.strike_price === strike && r.contract_type === "put")!.ticker;
  const prev = async (opt: string) => Prev.parse(await providerJson(`https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(opt)}/prev?adjusted=true&apiKey=${encodeURIComponent(apiKey)}`, { provider: "massive", ratePerSec: RATE, revalidate: 21_600, attempts: 2 })).results?.[0] ?? null;
  const cb = await prev(call);
  const pb = await prev(put);
  if (!cb || !pb) return { available: false, reason: "No previous-session trades for the ATM contracts." };
  const optionsDate = day(Math.max(cb.t, pb.t));
  return impliedMoveFromEodStraddle(
    { spot: spot.price, spotAsOf: spot.at, strike, callClose: cb.c, putClose: pb.c, optionsDate, expiry, tradingDays: tradingDaysBetween(optionsDate, expiry), contracts: { call, put }, source: "Massive options (end-of-day)" },
    now,
  );
}
