/** TradingView symbol for a US listing ("NASDAQ:AAPL"). Unknown exchanges fall back to the bare ticker. */
const ETF_VENUE: Record<string, string> = { SPY: "AMEX", IWM: "AMEX", UUP: "AMEX", XLE: "AMEX", XLF: "AMEX", QQQ: "NASDAQ", TLT: "NASDAQ" };
const VENUES = new Set(["NASDAQ", "NYSE", "AMEX", "CBOE"]);

export function tradingViewSymbol(ticker: string, exchange?: string | null): string {
  const t = ticker.toUpperCase();
  const venue = ETF_VENUE[t] ?? (exchange && VENUES.has(exchange.toUpperCase()) ? exchange.toUpperCase() : null);
  return venue ? `${venue}:${t}` : t;
}
