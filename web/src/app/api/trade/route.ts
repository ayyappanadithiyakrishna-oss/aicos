import { runRobinhoodTools, parseJsonFromText } from "@/lib/robinhoodMcp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* The ONLY account permitted to receive agentic orders. Robinhood enforces
   this at the API level; we enforce it here too so nothing else is reachable. */
const AGENTIC_ACCOUNT = "809438815";

interface TradeBody {
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit" | "stop";
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  accountNumber: string;
  confirmed?: boolean;
}

/* POST /api/trade
   review_equity_order to preview; if confirmed:true, place_equity_order.
   Hard-locked to account 809438815. MCP errors are returned verbatim. */
export async function POST(request: Request) {
  let body: TradeBody;
  try {
    body = (await request.json()) as TradeBody;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Account guard — non-negotiable.
  if (body.accountNumber !== AGENTIC_ACCOUNT) {
    return Response.json(
      { error: `Orders may only be placed on the agentic account ••••8815.` },
      { status: 403 },
    );
  }

  const { symbol, side, orderType, quantity, limitPrice, stopPrice, confirmed } = body;
  if (!symbol || !side || !orderType || !quantity || quantity <= 0) {
    return Response.json({ error: "Missing or invalid order fields" }, { status: 400 });
  }

  const priceClause =
    orderType === "limit" && limitPrice
      ? ` limit price ${limitPrice}`
      : orderType === "stop" && stopPrice
        ? ` stop price ${stopPrice}`
        : "";
  const spec = `account ${AGENTIC_ACCOUNT}, ${side} ${quantity} ${symbol.toUpperCase()}, ${orderType} order${priceClause}`;

  const prompt = confirmed
    ? `Place this equity order on Robinhood: ${spec}. First call review_equity_order to validate, then call place_equity_order to place it. After placing, return ONLY a JSON object {"order_id": "...", "state": "..."} with the resulting order id and state.`
    : `Preview this equity order without placing it: ${spec}. Call review_equity_order only and return the preview as JSON. Do NOT call place_equity_order.`;

  const run = await runRobinhoodTools({
    allowedTools: ["place_equity_order", "review_equity_order"],
    prompt,
    maxTokens: 3000,
  });

  if (!run) {
    return Response.json(
      { error: "Trading is not configured on the server (missing ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  // Surface any MCP tool error verbatim.
  const errored = run.results.find((r) => r.isError);
  if (errored) {
    return Response.json({ error: errored.raw || "Robinhood rejected the order." }, { status: 502 });
  }

  if (confirmed) {
    const place = run.results.find((r) => r.toolName === "place_equity_order");
    const fromJson = parseJsonFromText<{ order_id?: string; state?: string }>(run.text);
    const extracted = extractOrder(place?.data);
    const orderId = fromJson?.order_id ?? extracted.orderId;
    const state = fromJson?.state ?? extracted.state;
    return Response.json(
      { ok: true, orderId, state, raw: place?.data ?? run.text },
      noStore,
    );
  }

  const review = run.results.find((r) => r.toolName === "review_equity_order");
  return Response.json({ ok: true, preview: review?.data ?? run.text }, noStore);
}

const noStore = { headers: { "Cache-Control": "no-store" } };

function extractOrder(data: unknown): { orderId?: string; state?: string } {
  const o =
    data && typeof data === "object"
      ? ((data as Record<string, unknown>).data ?? data)
      : null;
  if (!o || typeof o !== "object") return {};
  const rec = o as Record<string, unknown>;
  return {
    orderId: rec.id ? String(rec.id) : rec.order_id ? String(rec.order_id) : undefined,
    state: rec.state ? String(rec.state) : undefined,
  };
}
