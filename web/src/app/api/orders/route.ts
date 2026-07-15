import { runRobinhoodTools } from "@/lib/robinhoodMcp";

export const dynamic = "force-dynamic";

// Sourced from env — the literal account number lives only in /api/trade's guard.
const AGENTIC_ACCOUNT = process.env.NEXT_PUBLIC_AICOS_ACCOUNT ?? "";

export interface OrderRow {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  state: string;
  type: string;
  price: number | null;
  createdAt: string | null;
}

/* GET /api/orders?account=809438815
   Returns recent equity orders for the agentic account via the Robinhood MCP
   get_equity_orders tool. Locked to the agentic account. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const account = searchParams.get("account") ?? AGENTIC_ACCOUNT;
  if (!AGENTIC_ACCOUNT || account !== AGENTIC_ACCOUNT) {
    return Response.json({ orders: [] }, noStore);
  }

  const run = await runRobinhoodTools({
    allowedTools: ["get_equity_orders"],
    prompt: `Call get_equity_orders for account ${AGENTIC_ACCOUNT}. Return the tool result verbatim — do not summarize.`,
    maxTokens: 3000,
  });

  if (!run) return Response.json({ orders: [] }, noStore);

  const orders: OrderRow[] = [];
  for (const r of run.results) {
    if (r.isError) continue;
    for (const raw of asArray(r.data)) orders.push(normalize(raw));
  }
  return Response.json({ orders: orders.filter(Boolean) }, noStore);
}

const noStore = { headers: { "Cache-Control": "no-store" } };

function asArray(data: unknown): Record<string, unknown>[] {
  const pick = (v: unknown): unknown => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return o.orders ?? o.results ?? (o.data ? pick(o.data) : undefined);
    }
    return undefined;
  };
  const arr = pick(data);
  return Array.isArray(arr)
    ? (arr.filter((x) => x && typeof x === "object") as Record<string, unknown>[])
    : [];
}

function normalize(o: Record<string, unknown>): OrderRow {
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: String(o.id ?? o.order_id ?? ""),
    symbol: String(o.symbol ?? o.chain_symbol ?? o.instrument_symbol ?? "").toUpperCase(),
    side: String(o.side ?? ""),
    quantity: num(o.quantity) ?? 0,
    state: String(o.state ?? ""),
    type: String(o.type ?? o.order_type ?? ""),
    price: num(o.price) ?? num(o.average_price) ?? num(o.stop_price),
    createdAt: o.created_at ? String(o.created_at) : null,
  };
}
