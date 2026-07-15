"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AlpacaAccount, AlpacaPosition, AlpacaOrder } from "@/lib/alpaca";

export interface AlpacaSnapshot {
  connected: boolean;
  reason?: string;
  account?: AlpacaAccount;
  positions?: AlpacaPosition[];
  orders?: AlpacaOrder[];
}

/* Polls /api/alpaca for the live paper account. 12s cadence keeps the P&L
   fresh without hammering the broker; refetch() forces an immediate refresh
   after an order so the UI reflects fills without waiting for the next tick. */
export function useAlpaca(pollMs = 12_000) {
  const [snapshot, setSnapshot] = useState<AlpacaSnapshot>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/alpaca", { cache: "no-store" });
      const data = (await res.json()) as AlpacaSnapshot;
      if (alive.current) {
        setSnapshot(data);
        setError(null);
      }
    } catch {
      if (alive.current) setError("Could not reach the Alpaca engine.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refetch();
    const id = setInterval(refetch, pollMs);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [refetch, pollMs]);

  return { snapshot, loading, error, refetch };
}
