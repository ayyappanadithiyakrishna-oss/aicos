import { isDemo } from "@/lib/data/service";
import { tickerCoverage } from "@/lib/data/coverage";
import { liveConfig } from "@/lib/live/registry";
import { buildLiveMaster } from "@/lib/live/master";
import { UNIVERSE } from "@/lib/live/universe";
import { massiveLatestNews } from "@/lib/providers/news";
import { error, json, TICKER_RE } from "@/lib/security/api";

export const maxDuration = 60;
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const symbol = (await ctx.params).symbol.toUpperCase();
  if (!TICKER_RE.test(symbol)) return error(400, "invalid_symbol", "Malformed ticker symbol");
  if (isDemo()) return json({ coverage: [], sentiment: null });
  if (!buildLiveMaster(UNIVERSE).byTicker(symbol)) return error(404, "unknown_symbol", "Ticker is outside the coverage universe");
  const cfg = liveConfig();
  if (!cfg.massiveKey || !cfg.massiveDisplay) return error(503, "not_configured", "Ticker news is unavailable on this deployment");
  try {
    const recs = await massiveLatestNews(cfg.massiveKey, new Date().toISOString(), { ticker: symbol, limit: 25, sinceDays: 14 });
    return json(tickerCoverage(recs, symbol), { cache: "short" });
  } catch {
    return error(503, "provider_busy", "The news provider is busy. Try again shortly.");
  }
}
