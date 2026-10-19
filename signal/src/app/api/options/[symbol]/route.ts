import { isDemo } from "@/lib/data/service";
import { error, json, TICKER_RE } from "@/lib/security/api";
import { liveConfig } from "@/lib/live/registry";
import { LivePriceStore } from "@/lib/live/prices";
import { buildLiveMaster } from "@/lib/live/master";
import { UNIVERSE } from "@/lib/live/universe";
import { massiveImpliedMove } from "@/lib/providers/massiveOptions";

/** Options-implied move for a covered underlying (live mode, Massive end-of-day options). */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const symbol = (await ctx.params).symbol.toUpperCase();
  if (!TICKER_RE.test(symbol)) return error(400, "invalid_symbol", "Malformed ticker symbol");
  if (isDemo()) return json({ available: false, reason: "Demo mode has no options data (synthetic securities)." }, { cache: "short" });
  const cfg = liveConfig();
  if (!cfg.massiveKey) return json({ available: false, reason: "Set MASSIVE_API_KEY to enable options-implied moves." }, { cache: "short" });
  const sec = buildLiveMaster(UNIVERSE).byTicker(symbol);
  if (!sec) return error(404, "unknown_symbol", `${symbol} is not covered`);
  const now = new Date();
  const prices = new LivePriceStore(cfg);
  await prices.prefetch([sec], now, 1);
  const last = prices.daily(sec.id)?.at(-1);
  if (!last) return json({ available: false, reason: "No spot price for this underlying." }, { cache: "short" });
  const move = await massiveImpliedMove(cfg.massiveKey, sec.ticker, { price: last.c, at: last.t }, now);
  return json({ ...move, ticker: sec.ticker, spot: last.c, spotAsOf: last.t }, { cache: move.available ? "long" : "short" });
}
