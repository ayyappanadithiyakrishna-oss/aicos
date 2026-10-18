import { getTicker } from "@/lib/data/service";
import { error, json, TICKER_RE } from "@/lib/security/api";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const symbol = (await ctx.params).symbol.toUpperCase();
  if (!TICKER_RE.test(symbol)) return error(400, "invalid_symbol", "Malformed ticker symbol");
  const t = await getTicker(symbol);
  if (!t) return error(404, "unknown_symbol", `${symbol} is not in the security master for this mode`);
  return json(t, { cache: "short" });
}
