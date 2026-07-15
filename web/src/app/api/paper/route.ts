export const dynamic = "force-dynamic";

interface PaperBody {
  symbol?: string;
  side?: string;
  shares?: number;
  price?: unknown; // intentionally ignored — see below
}

/* POST /api/paper  { symbol, side, shares }
   The server is the price authority. It receives only symbol/side/shares,
   fetches the current live price from /api/quote at execution time, and returns
   a priced fill with the quote's fetchedAt. A `price` in the body is IGNORED so
   the client can never inject a stale or manipulated price. */
export async function POST(request: Request) {
  let body: PaperBody;
  try {
    body = (await request.json()) as PaperBody;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const symbol = String(body.symbol ?? "").toUpperCase().trim();
  const side = body.side === "sell" ? "sell" : "buy";
  const shares = Number(body.shares);
  if (!symbol || !(shares > 0)) {
    return Response.json({ error: "Provide a symbol and a positive share count" }, { status: 400 });
  }

  // 1) Fetch the current live price NOW. (body.price is never read.)
  let price: number | undefined;
  let fetchedAt = Date.now();
  try {
    const quoteUrl = new URL(`/api/quote?symbols=${encodeURIComponent(symbol)}`, request.url);
    const res = await fetch(quoteUrl, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as {
        quotes?: { last?: number; price?: number }[];
        asOf?: string;
      };
      const q = data.quotes?.[0];
      price = q?.price ?? q?.last;
      if (data.asOf) {
        const t = Date.parse(data.asOf);
        if (!Number.isNaN(t)) fetchedAt = t;
      }
    }
  } catch {
    /* fall through to the error below */
  }

  if (!(price && price > 0)) {
    return Response.json(
      { error: "Could not fetch a live price for this symbol — try again." },
      { status: 502 },
    );
  }

  // 2) Return the priced fill for the client engine to apply.
  return Response.json(
    { ok: true, fill: { symbol, side, shares, price, fetchedAt } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
