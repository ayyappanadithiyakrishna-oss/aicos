import "server-only";
/**
 * Options-implied move for an underlying from Massive end-of-day option bars (Basic plan):
 * nearest weekly/monthly expiry ≥ 3 calendar days out, ATM strike, previous-session call + put closes.
 * Three requests per underlying; cached 6 hours because closes change once per session.
 */
import { z } from "zod";
import { impliedMoveFromEodStraddle, type EodImpliedMove } from "@/lib/quant/options";
import { providerJson } from "./http";
import { tradingDaysBetween } from "@/lib/calendar/nyse";
import { dateKeyOf } from "@/lib/calendar/time";

const RATE = 5 / 60;
const Contracts = z.object({ results: z.array(z.object({ ticker: z.string(), expiration_date: z.string(), strike_price: z.number(), contract_type: z.string() })).optional() });
const Prev = z.object({ results: z.array(z.object({ c: z.number(), t: z.number() })).optional() });

const cache = new Map<string, { at: number; ttl: number; p: Promise<EodImpliedMove> }>();

export function massiveImpliedMove(apiKey: string, ticker: string, spot: { price: number; at: string }, now = new Date()): Promise<EodImpliedMove> {
  const symbol = ticker.toUpperCase();
  const key = `${symbol}|${spot.at}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.p;
  const p = compute(apiKey, symbol, spot, now).catch((e): EodImpliedMove => ({ available: false, reason: e instanceof Error && /429|rate/i.test(e.message) ? "Options data rate-limited (5 requests/min); try again shortly." : "Options data unavailable for this underlying." }));
  const entry = { at: Date.now(), ttl: 6 * 3_600_000, p };
  cache.set(key, entry);
  void p.then((v) => { if (!v.available) entry.ttl = 60_000; });
  return p;
}

async function compute(apiKey: string, ticker: string, spot: { price: number; at: string }, now: Date): Promise<EodImpliedMove> {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const q = new URLSearchParams({
    underlying_ticker: ticker,
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
  const optionsDate = dateKeyOf(new Date(cb.t));
  if (optionsDate !== dateKeyOf(new Date(pb.t))) return { available: false, reason: "Call and put last traded on different sessions; a combined straddle would be misleading." };
  return impliedMoveFromEodStraddle(
    { spot: spot.price, spotAsOf: spot.at, strike, callClose: cb.c, putClose: pb.c, optionsDate, expiry, tradingDays: tradingDaysBetween(optionsDate, expiry), contracts: { call, put }, source: "Massive options (end-of-day)" },
    now,
  );
}
