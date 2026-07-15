"use client";

import { useEffect, useRef, useState } from "react";
import type { Quote } from "./market";

export type LiveQuote = Quote;

/* Poll /api/quote for live (Robinhood) quotes. No seeded values — when the API
   returns 503 the hook reports noData so the UI can show a NO DATA badge. */
export function useQuotes(symbols: string[], intervalMs = 15000) {
  const key = symbols.join(",");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [dataLive, setDataLive] = useState(false);
  const [noData, setNoData] = useState(false);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    async function pull() {
      try {
        const res = await fetch(`/api/quote?symbols=${encodeURIComponent(key)}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) {
            setNoData(true);
            setDataLive(false);
          }
          return;
        }
        const data = (await res.json()) as { quotes?: Quote[]; isRealTime?: boolean };
        if (cancelled || keyRef.current !== key) return;
        const map: Record<string, Quote> = {};
        for (const q of data.quotes ?? []) map[q.ticker] = q;
        setQuotes(map);
        setDataLive(Boolean(data.isRealTime));
        setNoData(false);
        setUpdatedAt(Date.now());
      } catch {
        if (!cancelled) {
          setNoData(true);
          setDataLive(false);
        }
      }
    }

    pull();
    const id = setInterval(pull, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key, intervalMs]);

  return { quotes, updatedAt, dataLive, noData };
}
