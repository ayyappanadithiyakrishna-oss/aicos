import {
  alpacaConfigured,
  getSnapshot,
  placeOrder,
  cancelOrder,
  closePosition,
  AlpacaNotConfigured,
  AlpacaError,
  type PlaceOrderInput,
} from "@/lib/alpaca";

export const dynamic = "force-dynamic";

/* GET /api/alpaca
   One-shot snapshot for the dashboard poll: connection state + account,
   positions, and recent orders. Never leaks credentials. */
export async function GET() {
  if (!alpacaConfigured()) {
    return Response.json(
      { connected: false, reason: "no_credentials" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const snapshot = await getSnapshot();
    return Response.json(
      { connected: true, ...snapshot },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return handleError(err);
  }
}

/* POST /api/alpaca
   Place a paper order. Committee verdicts pass stop + takeProfit to submit a
   bracket order that mirrors the ruling into the broker. */
export async function POST(request: Request) {
  let body: Partial<PlaceOrderInput>;
  try {
    body = (await request.json()) as Partial<PlaceOrderInput>;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const symbol = String(body.symbol ?? "").toUpperCase().trim();
  const side = body.side === "sell" ? "sell" : "buy";
  const qty = body.qty != null ? Number(body.qty) : undefined;
  const notional = body.notional != null ? Number(body.notional) : undefined;

  if (!symbol) return Response.json({ error: "Provide a symbol" }, { status: 400 });
  if (!(qty && qty > 0) && !(notional && notional > 0)) {
    return Response.json(
      { error: "Provide a positive share quantity or dollar amount" },
      { status: 400 },
    );
  }

  try {
    const order = await placeOrder({
      symbol,
      side,
      qty,
      notional,
      type: body.type === "limit" ? "limit" : "market",
      limitPrice: body.limitPrice != null ? Number(body.limitPrice) : undefined,
      timeInForce: body.timeInForce === "gtc" ? "gtc" : undefined,
      stopLoss: body.stopLoss != null ? Number(body.stopLoss) : undefined,
      takeProfit: body.takeProfit != null ? Number(body.takeProfit) : undefined,
    });
    return Response.json({ ok: true, order }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleError(err);
  }
}

/* DELETE /api/alpaca?order=<id>   → cancel an open order
   DELETE /api/alpaca?position=<sym> → liquidate a position */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("order");
  const position = url.searchParams.get("position");
  try {
    if (orderId) {
      await cancelOrder(orderId);
      return Response.json({ ok: true });
    }
    if (position) {
      const order = await closePosition(position);
      return Response.json({ ok: true, order });
    }
    return Response.json({ error: "Provide ?order or ?position" }, { status: 400 });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown): Response {
  if (err instanceof AlpacaNotConfigured) {
    return Response.json({ connected: false, reason: "no_credentials" }, { status: 200 });
  }
  if (err instanceof AlpacaError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Alpaca request failed";
  return Response.json({ error: message }, { status: 502 });
}
