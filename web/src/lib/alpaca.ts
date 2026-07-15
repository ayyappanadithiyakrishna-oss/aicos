/* Alpaca paper-trading engine (server-side only).

   This is the live brokerage the AICOS terminal trades against. It talks to
   Alpaca's PAPER endpoint exclusively — https://paper-api.alpaca.markets — so
   no real capital is ever at risk. Credentials come from the environment and
   NEVER reach the client:

     APCA_API_KEY_ID      — paper key id
     APCA_API_SECRET_KEY  — paper secret

   When keys are absent, `alpacaConfigured()` is false and every call throws
   AlpacaNotConfigured; the API routes translate that into a clean
   "not connected" state the UI renders as a connect prompt. */

const BASE = process.env.ALPACA_PAPER_BASE_URL ?? "https://paper-api.alpaca.markets";

export class AlpacaNotConfigured extends Error {
  constructor() {
    super("Alpaca paper trading is not connected — set APCA_API_KEY_ID and APCA_API_SECRET_KEY.");
    this.name = "AlpacaNotConfigured";
  }
}

export class AlpacaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AlpacaError";
    this.status = status;
  }
}

export function alpacaConfigured(): boolean {
  return Boolean(process.env.APCA_API_KEY_ID && process.env.APCA_API_SECRET_KEY);
}

function headers(): HeadersInit {
  return {
    "APCA-API-KEY-ID": process.env.APCA_API_KEY_ID ?? "",
    "APCA-API-SECRET-KEY": process.env.APCA_API_SECRET_KEY ?? "",
    "Content-Type": "application/json",
  };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!alpacaConfigured()) throw new AlpacaNotConfigured();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* keep raw text */
    }
    throw new AlpacaError(res.status, msg || `Alpaca request failed (${res.status})`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/* ── Wire types (subset of Alpaca's response shapes) ─────────── */

export interface AlpacaAccount {
  id: string;
  status: string;
  currency: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  last_equity: string;
  buying_power: string;
  long_market_value: string;
  pattern_day_trader: boolean;
  daytrade_count: number;
  trading_blocked: boolean;
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  unrealized_intraday_pl: string;
  side: "long" | "short";
  change_today: string;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: string | null;
  notional: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  type: string;
  order_class: string;
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  status: string;
  submitted_at: string;
  filled_at: string | null;
}

/* ── Reads ───────────────────────────────────────────────────── */

export function getAccount() {
  return call<AlpacaAccount>("/v2/account");
}

export function getPositions() {
  return call<AlpacaPosition[]>("/v2/positions");
}

export function getOrders(status: "open" | "closed" | "all" = "all", limit = 50) {
  return call<AlpacaOrder[]>(
    `/v2/orders?status=${status}&limit=${limit}&direction=desc&nested=true`,
  );
}

/* One round-trip snapshot for the dashboard poll. */
export async function getSnapshot() {
  const [account, positions, orders] = await Promise.all([
    getAccount(),
    getPositions(),
    getOrders("all", 25),
  ]);
  return { account, positions, orders };
}

/* ── Writes ──────────────────────────────────────────────────── */

export interface PlaceOrderInput {
  symbol: string;
  side: "buy" | "sell";
  qty?: number; // whole/fractional shares
  notional?: number; // dollar amount (alternative to qty)
  type?: "market" | "limit";
  limitPrice?: number;
  timeInForce?: "day" | "gtc";
  /* When both are present the order is submitted as a bracket — mirroring a
     committee verdict's stop + target directly into the broker. */
  stopLoss?: number;
  takeProfit?: number;
}

export function placeOrder(input: PlaceOrderInput) {
  const bracket = input.stopLoss != null && input.takeProfit != null;
  const body: Record<string, unknown> = {
    symbol: input.symbol.toUpperCase().trim(),
    side: input.side,
    type: input.type ?? "market",
    time_in_force: input.timeInForce ?? (bracket ? "gtc" : "day"),
  };
  if (input.notional != null) body.notional = input.notional;
  else body.qty = input.qty;
  if (input.type === "limit" && input.limitPrice != null) body.limit_price = input.limitPrice;
  if (bracket) {
    body.order_class = "bracket";
    body.take_profit = { limit_price: input.takeProfit };
    body.stop_loss = { stop_price: input.stopLoss };
  }
  return call<AlpacaOrder>("/v2/orders", { method: "POST", body: JSON.stringify(body) });
}

export function cancelOrder(id: string) {
  return call<void>(`/v2/orders/${id}`, { method: "DELETE" });
}

export function closePosition(symbol: string) {
  return call<AlpacaOrder>(`/v2/positions/${encodeURIComponent(symbol.toUpperCase())}`, {
    method: "DELETE",
  });
}
