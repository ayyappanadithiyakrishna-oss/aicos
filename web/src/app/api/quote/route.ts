import { fetchRobinhoodQuotes } from "@/lib/quotes";
import type { Quote } from "@/lib/market";

export const dynamic = "force-dynamic";

/* GET /api/quote?symbols=NVDA,AAPL
   Robinhood real-time only. No Yahoo fallback, no seeded fallback. If live data
   is unavailable (no key / MCP down / nothing returned) → 503. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("symbols") ?? searchParams.get("symbol") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 25);

  if (symbols.length === 0) {
    return Response.json({ error: "no symbols" }, { status: 400 });
  }

  const rh = await fetchRobinhoodQuotes(symbols);
  if (rh.size === 0) {
    return Response.json(
      { error: "Live data unavailable", isRealTime: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const quotes: Quote[] = symbols.map((s) => rh.get(s)).filter((q): q is Quote => !!q);
  return Response.json(
    { quotes, asOf: new Date().toISOString(), isRealTime: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
