"use client";

import { useEffect, useState } from "react";

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

const OPEN_STATES = new Set(["queued", "confirmed", "unconfirmed", "partially_filled"]);

/* Poll /api/orders for the agentic account every 10s. Returns open orders
   (working) and recent fills, plus the last refresh time. */
export function useOrders(account: string, intervalMs = 10000) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;

    async function pull() {
      try {
        const res = await fetch(`/api/orders?account=${encodeURIComponent(account)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { orders?: OrderRow[] };
        if (cancelled) return;
        setOrders(data.orders ?? []);
        setUpdatedAt(Date.now());
      } catch {
        /* keep last known */
      }
    }

    pull();
    const id = setInterval(pull, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [account, intervalMs]);

  const open = orders.filter((o) => OPEN_STATES.has(o.state.toLowerCase()));
  const fills = orders.filter((o) => o.state.toLowerCase() === "filled");

  return { orders, open, fills, updatedAt };
}
