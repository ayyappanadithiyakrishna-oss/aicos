/* Quote shape + a structural fallback. No seeded prices, holdings, watchlist,
   news, or macro data live here — the app uses live data only (Robinhood via
   /api/quote). getQuote returns a zeroed Quote (never fabricated prices) for
   components that need a Quote-shaped placeholder before live data arrives. */

export interface Quote {
  ticker: string;
  name: string;
  last: number;
  change: number; // absolute
  changePct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number | null;
  marketCap: number | null;
  pe: number;

  /* real-time / extended-hours superset (populated by /api/quote) */
  symbol?: string;
  price?: number;
  changePercent?: number;
  previousClose?: number;
  extendedPrice?: number | null;
  extendedChange?: number | null;
  extendedChangePercent?: number | null;
  extendedPriceTime?: string | null; // e.g. "Pre-market", "After hours"
  bid?: number | null;
  ask?: number | null;
  isRealTime?: boolean; // true when sourced live from Robinhood
}

/** Zeroed Quote placeholder for a symbol — carries no fabricated prices. */
export function getQuote(ticker: string): Quote {
  const symbol = ticker.toUpperCase();
  return {
    ticker: symbol,
    name: symbol,
    last: 0,
    change: 0,
    changePct: 0,
    open: 0,
    high: 0,
    low: 0,
    prevClose: 0,
    volume: null,
    marketCap: null,
    pe: 0,
    symbol,
    price: 0,
    changePercent: 0,
    previousClose: 0,
    extendedPrice: null,
    extendedChange: null,
    extendedChangePercent: null,
    extendedPriceTime: null,
    bid: null,
    ask: null,
    isRealTime: false,
  };
}
