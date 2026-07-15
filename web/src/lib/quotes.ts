/* Server-side live quote fetcher — Robinhood only (no Yahoo, no seeded book).
   Returns real-time quotes via the Robinhood MCP get_equity_quotes tool. Used
   by /api/quote and by the live committee for analysis context. */

import { runRobinhoodTools } from "./robinhoodMcp";
import type { Quote } from "./market";

export async function fetchRobinhoodQuotes(
  symbols: string[],
): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  const wanted = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean);
  if (wanted.length === 0 || !process.env.ANTHROPIC_API_KEY) return out;

  try {
    const run = await runRobinhoodTools({
      allowedTools: ["get_equity_quotes"],
      maxTokens: 3000,
      prompt: `Call get_equity_quotes for these symbols: ${wanted.join(
        ", ",
      )}. Return the tool result verbatim — do not summarize.`,
    });
    if (!run) return out;

    for (const r of run.results) {
      if (r.isError) continue;
      for (const entry of extractEntries(r.data)) {
        const q = normalizeRobinhood(entry);
        if (q) out.set(q.ticker, q);
      }
    }
  } catch (err) {
    console.error("[quotes] Robinhood fetch failed:", err);
  }
  return out;
}

/* The live get_equity_quotes result is { data: { results: [ { quote, close } ] } }. */
interface RHEntry {
  quote: Record<string, unknown>;
  close?: Record<string, unknown>;
}

function extractEntries(payload: unknown): RHEntry[] {
  const obj = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;

  const root = obj(payload);
  const data = root ? obj(root.data) : null;
  const arr =
    (data?.results as unknown) ??
    (root?.results as unknown) ??
    (Array.isArray(payload) ? payload : []);

  if (!Array.isArray(arr)) return [];
  return arr
    .map((e) => obj(e))
    .filter((e): e is Record<string, unknown> => e !== null && obj(e.quote) !== null)
    .map((e) => ({ quote: e.quote as Record<string, unknown>, close: obj(e.close) ?? undefined }));
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeRobinhood(entry: RHEntry): Quote | null {
  const { quote, close } = entry;
  if (quote.has_traded === false) return null;
  if (typeof quote.state === "string" && quote.state !== "active") return null;

  const symbol = String(quote.symbol ?? "").toUpperCase();
  if (!symbol) return null;

  const price = num(quote.last_trade_price);
  const previousClose = num(close?.price) ?? num(quote.previous_close);
  if (price === undefined || previousClose === undefined) return null;

  const change = price - previousClose;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;

  const rawNonReg = quote.last_non_reg_trade_price;
  const extendedPrice =
    rawNonReg === null || rawNonReg === undefined || rawNonReg === ""
      ? null
      : num(rawNonReg) ?? null;
  let extendedChange: number | null = null;
  let extendedChangePercent: number | null = null;
  let extendedPriceTime: string | null = null;
  if (extendedPrice !== null) {
    extendedChange = extendedPrice - previousClose;
    extendedChangePercent = previousClose ? (extendedChange / previousClose) * 100 : 0;
    extendedPriceTime = extendedSession(
      quote.venue_last_non_reg_trade_time,
      quote.venue_last_trade_time,
    );
  }

  const bidV = num(quote.bid_price);
  const askV = num(quote.ask_price);

  return {
    ticker: symbol,
    name: symbol,
    last: price,
    change,
    changePct: changePercent,
    open: previousClose,
    high: Math.max(price, previousClose, extendedPrice ?? -Infinity),
    low: Math.min(price, previousClose, extendedPrice ?? Infinity),
    prevClose: previousClose,
    volume: null,
    marketCap: null,
    pe: 0,
    symbol,
    price,
    changePercent,
    previousClose,
    extendedPrice,
    extendedChange,
    extendedChangePercent,
    extendedPriceTime,
    bid: bidV && bidV > 0 ? bidV : null,
    ask: askV && askV > 0 ? askV : null,
    isRealTime: true,
  };
}

function extendedSession(nonReg: unknown, lastReg: unknown): string | null {
  if (typeof nonReg !== "string") return null;
  const n = Date.parse(nonReg);
  if (Number.isNaN(n)) return null;
  const l = typeof lastReg === "string" ? Date.parse(lastReg) : NaN;
  if (!Number.isNaN(l) && n <= l) return null;
  const d = new Date(n);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (mins < 14 * 60 + 30) return "Pre-market";
  if (mins >= 21 * 60) return "After hours";
  return null;
}
