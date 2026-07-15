/* Maps a ticker to the domain used for logo.dev lookups. null → render a
   monogram fallback. */
const DOMAINS: Record<string, string> = {
  NBIS: "nebius.com",
  ASTS: "ast-science.com",
  AAOI: "ao-inc.com",
  MU: "micron.com",
  INTC: "intel.com",
  ARM: "arm.com",
  AVGO: "broadcom.com",
  META: "meta.com",
  TSLA: "tesla.com",
  NVDA: "nvidia.com",
  AAPL: "apple.com",
  AMZN: "amazon.com",
  GOOGL: "google.com",
  MSFT: "microsoft.com",
};

export function getLogoDomain(symbol: string): string | null {
  return DOMAINS[symbol.toUpperCase()] ?? null;
}

export const LOGO_DEV_TOKEN = "pk_X8RF3QbGQmKbXWLbC0aLyg";

export function logoUrl(symbol: string): string | null {
  const domain = getLogoDomain(symbol);
  return domain ? `https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}` : null;
}
