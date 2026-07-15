/* Maps a ticker to its TradingView exchange prefix. Defaults to NASDAQ. */
const EXCHANGE: Record<string, "NASDAQ" | "NYSE"> = {
  NBIS: "NASDAQ",
  ASTS: "NASDAQ",
  AAOI: "NASDAQ",
  MU: "NASDAQ",
  INTC: "NASDAQ",
  ARM: "NASDAQ",
  AVGO: "NASDAQ",
  META: "NASDAQ",
  TSLA: "NASDAQ",
  NVDA: "NASDAQ",
  AAPL: "NASDAQ",
  AMZN: "NASDAQ",
  GOOGL: "NASDAQ",
  MSFT: "NASDAQ",
};

export function getExchangePrefix(symbol: string): string {
  return EXCHANGE[symbol.toUpperCase()] ?? "NASDAQ";
}
