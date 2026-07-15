import { runRobinhoodTools, parseJsonFromText } from "@/lib/robinhoodMcp";

export const dynamic = "force-dynamic";

export interface SearchResult {
  symbol: string;
  name: string;
  type: string;
}

/* Static fallback universe — used when the Robinhood MCP search is unavailable. */
const FALLBACK: SearchResult[] = [
  { symbol: "NBIS", name: "Nebius Group", type: "stock" },
  { symbol: "ASTS", name: "AST SpaceMobile", type: "stock" },
  { symbol: "AAOI", name: "Applied Optoelectronics", type: "stock" },
  { symbol: "MU", name: "Micron Technology", type: "stock" },
  { symbol: "INTC", name: "Intel Corporation", type: "stock" },
  { symbol: "ARM", name: "Arm Holdings", type: "stock" },
  { symbol: "AVGO", name: "Broadcom", type: "stock" },
  { symbol: "META", name: "Meta Platforms", type: "stock" },
  { symbol: "TSLA", name: "Tesla", type: "stock" },
  { symbol: "NVDA", name: "NVIDIA Corporation", type: "stock" },
];

/* GET /api/search?q=apple
   Resolves a free-text query to tradable tickers via the Robinhood MCP `search`
   tool. Falls back to a filtered static universe if the MCP path is unavailable. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  const results = await searchRobinhood(q);
  if (results && results.length > 0) {
    return Response.json({ results: results.slice(0, 8) }, noStore);
  }
  return Response.json({ results: fallback(q) }, noStore);
}

const noStore = { headers: { "Cache-Control": "no-store" } };

async function searchRobinhood(q: string): Promise<SearchResult[] | null> {
  if (!q) return null;
  try {
    const run = await runRobinhoodTools({
      allowedTools: ["search"],
      maxTokens: 2048,
      prompt: `Call the Robinhood search tool with the query "${q}". Return ONLY a JSON object of the form {"results":[{"symbol":"AAPL","name":"Apple Inc.","type":"stock"}]} containing up to 8 tradable US equities most relevant to the query. No prose.`,
    });
    if (!run) return null;

    // Prefer the model's clean JSON; fall back to raw tool-result payloads.
    const fromText = parseJsonFromText<{ results?: SearchResult[] }>(run.text);
    if (fromText?.results?.length) return clean(fromText.results);

    for (const r of run.results) {
      if (r.isError) continue;
      const recs = extractInstruments(r.data);
      if (recs.length) return clean(recs);
    }
    return null;
  } catch {
    return null;
  }
}

function extractInstruments(data: unknown): SearchResult[] {
  const out: SearchResult[] = [];
  const arr = asArray(data);
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const symbol = String(o.symbol ?? o.ticker ?? "").toUpperCase();
    if (!symbol) continue;
    out.push({
      symbol,
      name: String(o.name ?? o.simple_name ?? o.long_name ?? symbol),
      type: String(o.type ?? o.instrument_type ?? "stock"),
    });
  }
  return out;
}

function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.results)) return o.results;
    if (Array.isArray(o.instruments)) return o.instruments;
    if (o.data) return asArray(o.data);
  }
  return [];
}

function clean(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const symbol = String(r.symbol ?? "").toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({ symbol, name: String(r.name ?? symbol), type: String(r.type ?? "stock") });
  }
  return out;
}

function fallback(q: string): SearchResult[] {
  const query = q.toUpperCase();
  if (!query) return FALLBACK.slice(0, 8);
  return FALLBACK.filter(
    (r) => r.symbol.includes(query) || r.name.toUpperCase().includes(query),
  ).slice(0, 8);
}
