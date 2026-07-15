/* Paper trading engine.

   Hard rule: a paper trade is ALWAYS priced at a fresh, live quote captured at
   execution time. This module never imports the seeded market book — price and
   its fetchedAt timestamp must be supplied by the caller, and a quote older than
   60s is rejected. The server (/api/paper) is the price authority; the client
   applies the returned fill here. Stops are evaluated against the live 15s poll. */

export const STARTING_CASH = 500;
export const STORAGE_KEY = "aicos_paper_portfolio_v2"; // v2 abandons any stale book
export const RISK_PERCENT = 0.08; // 8% risk unit
export const STOP_PCT = RISK_PERCENT; // back-compat alias
export const MAX_QUOTE_AGE_MS = 60_000;

/* ============================================================
   The ONLY two risk formulas permitted in the codebase.
   stop loss  = entryPrice × 0.92            (1 − riskPercent)
   take profit = entryPrice × (1 + 0.08×3)   = entryPrice × 1.24  (3:1 R/R)
   Every stop or target price anywhere must come from these.
   ============================================================ */
export function stopLoss(entryPrice: number): number {
  return round2(entryPrice * 0.92);
}
export function takeProfit(entryPrice: number): number {
  return round2(entryPrice * (1 + RISK_PERCENT * 3));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type Side = "buy" | "sell" | "STOP";

export interface PaperTrade {
  id: string;
  symbol: string;
  side: Side;
  shares: number;
  price: number;
  fetchedAt: number; // when the live quote was captured
  executedAt: number; // when the trade was applied
  triggerPrice?: number; // STOP only
  realizedPL?: number; // sell / STOP only
  tier?: string; // committee verdict tier that authorized it
  stop?: number | null;
  takeProfit?: number | null;
}

export interface PaperPosition {
  symbol: string;
  shares: number;
  avgCost: number;
  stop?: number | null; // committee stop (or formula default)
  takeProfit?: number | null; // committee target (or formula default)
  tier?: string;
}

export interface PaperPortfolioState {
  cash: number;
  positions: PaperPosition[];
  trades: PaperTrade[];
  createdAt: number;
  benchmarks?: { at: number; spy: number; qqq: number };
}

export interface MarkedPosition extends PaperPosition {
  currentPrice: number;
  marketValue: number;
  unrealizedPL: number;
  unrealizedPLPct: number;
}

export interface StopBreach {
  symbol: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  lossPct: number;
}

/** A priced fill — the only way to move the portfolio. price + fetchedAt must
 *  originate from a live quote, not from component state or the seeded book. */
export interface Fill {
  symbol: string;
  side: Side;
  shares: number;
  price: number;
  fetchedAt: number;
  stop?: number | null;
  takeProfit?: number | null;
  tier?: string;
}

export function emptyPortfolio(): PaperPortfolioState {
  return { cash: STARTING_CASH, positions: [], trades: [], createdAt: Date.now() };
}

export function loadPortfolio(): PaperPortfolioState {
  if (typeof window === "undefined") return emptyPortfolio();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyPortfolio();
    const parsed = JSON.parse(raw) as PaperPortfolioState;
    if (typeof parsed.cash !== "number" || !Array.isArray(parsed.positions)) {
      return emptyPortfolio();
    }
    return { cash: parsed.cash, positions: parsed.positions, trades: parsed.trades ?? [], createdAt: parsed.createdAt ?? Date.now() };
  } catch {
    return emptyPortfolio();
  }
}

export function savePortfolio(p: PaperPortfolioState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* quota / private mode — ignore */
  }
}

/** Apply a priced fill. Rejects stale quotes and overspend. Pure: returns a new
 *  portfolio plus the trade record; never reads any external price source. */
export function executePaperTrade(
  portfolio: PaperPortfolioState,
  fill: Fill,
  now: number = Date.now(),
): { portfolio: PaperPortfolioState; trade: PaperTrade } {
  if (now - fill.fetchedAt > MAX_QUOTE_AGE_MS) {
    throw new Error("Price quote is stale — refresh and retry");
  }
  if (!(fill.shares > 0)) throw new Error("Share count must be positive");
  if (!(fill.price > 0)) throw new Error("Live price unavailable");

  const positions = portfolio.positions.map((p) => ({ ...p }));
  let cash = portfolio.cash;
  const idx = positions.findIndex((p) => p.symbol === fill.symbol);
  let realizedPL: number | undefined;

  if (fill.side === "buy") {
    const cost = fill.shares * fill.price;
    if (cost > cash + 1e-6) throw new Error("Insufficient paper cash for this order");
    cash -= cost;
    if (idx >= 0) {
      const pos = positions[idx];
      const total = pos.shares + fill.shares;
      pos.avgCost = (pos.avgCost * pos.shares + fill.price * fill.shares) / total;
      pos.shares = total;
    } else {
      positions.push({ symbol: fill.symbol, shares: fill.shares, avgCost: fill.price });
    }
  } else {
    // sell or STOP
    if (idx < 0) throw new Error(`No paper position in ${fill.symbol} to sell`);
    const pos = positions[idx];
    const sellShares = Math.min(fill.shares, pos.shares);
    realizedPL = (fill.price - pos.avgCost) * sellShares;
    cash += sellShares * fill.price;
    pos.shares -= sellShares;
    if (pos.shares <= 1e-9) positions.splice(idx, 1);
  }

  const trade: PaperTrade = {
    id: makeId(),
    symbol: fill.symbol,
    side: fill.side,
    shares: fill.shares,
    price: fill.price,
    fetchedAt: fill.fetchedAt,
    executedAt: now,
    triggerPrice: fill.side === "STOP" ? fill.price : undefined,
    realizedPL,
  };

  return {
    portfolio: { cash, positions, trades: [trade, ...portfolio.trades].slice(0, 100), createdAt: portfolio.createdAt },
    trade,
  };
}

/** Positions whose live price has breached the stop (entryPrice × 0.92).
 *  Runs on every poll. */
export function checkStopLosses(
  positions: PaperPosition[],
  prices: Record<string, number>,
): StopBreach[] {
  const out: StopBreach[] = [];
  for (const p of positions) {
    const cp = prices[p.symbol];
    if (cp == null || !(p.shares > 0) || !(p.avgCost > 0)) continue;
    if (cp <= stopLoss(p.avgCost)) {
      out.push({
        symbol: p.symbol,
        shares: p.shares,
        avgCost: p.avgCost,
        currentPrice: cp,
        lossPct: ((cp - p.avgCost) / p.avgCost) * 100,
      });
    }
  }
  return out;
}

/** Mark positions to the live poll. currentPrice never comes from the book. */
export function markPositions(
  positions: PaperPosition[],
  prices: Record<string, number>,
): MarkedPosition[] {
  return positions.map((p) => {
    const currentPrice = prices[p.symbol] ?? p.avgCost;
    const marketValue = currentPrice * p.shares;
    const cost = p.avgCost * p.shares;
    const unrealizedPL = marketValue - cost;
    return {
      ...p,
      currentPrice,
      marketValue,
      unrealizedPL,
      unrealizedPLPct: cost ? (unrealizedPL / cost) * 100 : 0,
    };
  });
}

/** Local time, MMM DD, YYYY HH:mm:ss — never a Unix or UTC string. */
export function formatReceiptTime(ms: number): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
