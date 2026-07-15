/* Static placeholder data used before live Robinhood data arrives.
   All prices are zeroed — real quotes come from /api/quote. */

export interface Holding {
  ticker: string;
  name: string;
  shares: number;
  last: number;
  avgCost: number;
}

export interface WatchlistItem {
  ticker: string;
  name: string;
  sector: string;
  last: number;
  changePct: number;
}

export interface NewsItem {
  source: string;
  time: string;
  headline: string;
  sentiment: "pos" | "neg" | "neu";
}

export interface MacroItem {
  label: string;
  value: string;
  delta: string;
  tone: "pos" | "neg" | "neu";
}

export interface PortfolioStats {
  total: number;
  buyingPower: number;
  dayPnl: number;
  dayPnlPct: number;
  totalPnl: number;
  totalPnlPct: number;
}

export const HOLDINGS: Holding[] = [
  { ticker: "AAPL", name: "Apple Inc.", shares: 0, last: 0, avgCost: 0 },
  { ticker: "NVDA", name: "NVIDIA Corp.", shares: 0, last: 0, avgCost: 0 },
  { ticker: "MSFT", name: "Microsoft Corp.", shares: 0, last: 0, avgCost: 0 },
  { ticker: "AMZN", name: "Amazon.com Inc.", shares: 0, last: 0, avgCost: 0 },
  { ticker: "GOOGL", name: "Alphabet Inc.", shares: 0, last: 0, avgCost: 0 },
];

export const WATCHLIST: WatchlistItem[] = [
  { ticker: "AAPL", name: "Apple Inc.", sector: "Technology", last: 0, changePct: 0 },
  { ticker: "NVDA", name: "NVIDIA Corp.", sector: "Semiconductors", last: 0, changePct: 0 },
  { ticker: "MSFT", name: "Microsoft Corp.", sector: "Technology", last: 0, changePct: 0 },
  { ticker: "AMZN", name: "Amazon.com Inc.", sector: "Consumer", last: 0, changePct: 0 },
  { ticker: "GOOGL", name: "Alphabet Inc.", sector: "Technology", last: 0, changePct: 0 },
  { ticker: "META", name: "Meta Platforms", sector: "Technology", last: 0, changePct: 0 },
  { ticker: "TSLA", name: "Tesla Inc.", sector: "Automotive", last: 0, changePct: 0 },
  { ticker: "BRK.B", name: "Berkshire Hathaway", sector: "Financials", last: 0, changePct: 0 },
];

export const NEWS: NewsItem[] = [
  { source: "Bloomberg", time: "12m", headline: "Connect ANTHROPIC_API_KEY for live AI-generated news commentary", sentiment: "neu" },
  { source: "Reuters", time: "1h", headline: "Markets await — set your API key to surface real-time intelligence", sentiment: "neu" },
  { source: "WSJ", time: "2h", headline: "AI committee ready to convene once ticker is selected", sentiment: "neu" },
];

export const MACRO: MacroItem[] = [
  { label: "10Y YIELD", value: "—", delta: "—", tone: "neu" },
  { label: "VIX", value: "—", delta: "—", tone: "neu" },
  { label: "DXY", value: "—", delta: "—", tone: "neu" },
  { label: "SPX", value: "—", delta: "—", tone: "neu" },
  { label: "GOLD", value: "—", delta: "—", tone: "neu" },
  { label: "WTI", value: "—", delta: "—", tone: "neu" },
  { label: "BTC", value: "—", delta: "—", tone: "neu" },
  { label: "EUR/USD", value: "—", delta: "—", tone: "neu" },
];

export function portfolioStats(): PortfolioStats {
  return {
    total: 0,
    buyingPower: 0,
    dayPnl: 0,
    dayPnlPct: 0,
    totalPnl: 0,
    totalPnlPct: 0,
  };
}
