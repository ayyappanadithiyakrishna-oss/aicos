"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Quote } from "@/lib/market";
import { usd, pct, compact } from "@/lib/utils";
import { Delta } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export function QuotePanel({
  quote,
  symbol,
}: {
  quote?: Quote;
  symbol?: string;
}) {
  if (!quote || !quote.isRealTime) {
    return (
      <div className="grid place-items-center px-5 py-10 text-center">
        <p className="text-body-sm text-ash">Live data unavailable — check API key</p>
        {symbol && <p className="mono mt-1 text-caption text-mute">{symbol}</p>}
      </div>
    );
  }

  return <LiveQuote quote={quote} />;
}

function LiveQuote({ quote }: { quote: Quote }) {
  const prevRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (prevRef.current !== null && prevRef.current !== quote.last) {
      setFlash(quote.last > prevRef.current ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 600);
      return () => clearTimeout(t);
    }
    prevRef.current = quote.last;
  }, [quote.last]);

  const up = quote.change >= 0;

  const rows: [string, string][] = [
    ["Open",      usd(quote.open)],
    ["High",      usd(quote.high)],
    ["Low",       usd(quote.low)],
    ["Prev close",usd(quote.prevClose)],
    ["Volume",    quote.volume != null ? compact(quote.volume) : "—"],
    ["Mkt cap",   quote.marketCap != null ? `$${compact(quote.marketCap)}` : "—"],
    ["Bid",       quote.bid != null ? usd(quote.bid) : "—"],
    ["Ask",       quote.ask != null ? usd(quote.ask) : "—"],
  ];

  return (
    <div className="px-5 py-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-baseline gap-2">
            <h2 className="display text-heading-lg leading-none text-bone">
              {quote.ticker}
            </h2>
            <span className="text-caption text-ash">{quote.name}</span>
          </div>

          {/* Price with flash */}
          <div className="relative mt-2">
            <AnimatePresence>
              {flash && (
                <motion.span
                  key={flash}
                  initial={{ opacity: 0.6 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.55 }}
                  className={cn(
                    "pointer-events-none absolute inset-0 rounded-[4px]",
                    flash === "up" ? "bg-bull/20" : "bg-bear/20",
                  )}
                />
              )}
            </AnimatePresence>
            <motion.p
              key={quote.last}
              initial={{ opacity: 0.6, y: flash === "up" ? 4 : flash === "down" ? -4 : 0 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="mono text-display leading-none text-bone"
            >
              {usd(quote.last)}
            </motion.p>
          </div>

          {quote.extendedPrice != null && (
            <p className="mt-2 flex items-baseline gap-2 font-geist text-body-sm">
              <span className="text-ash">{quote.extendedPriceTime ?? "Extended hours"}</span>
              <span className="text-frost">{usd(quote.extendedPrice)}</span>
              {quote.extendedChangePercent != null && (
                <Delta value={quote.extendedChangePercent}>
                  {pct(quote.extendedChangePercent)}
                </Delta>
              )}
            </p>
          )}
        </div>

        <div className="text-right">
          <Delta value={quote.change} className="text-heading-sm">
            {usd(quote.change)}
          </Delta>
          <div
            className={cn(
              "mono mt-1 inline-flex items-center rounded-pill border px-2 py-0.5 text-caption",
              up ? "border-bull/40 text-bull" : "border-bear/40 text-bear",
            )}
          >
            {pct(quote.changePct)}
          </div>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-4">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="text-[11px] text-mute">{k}</dt>
            <dd className="mono text-body-sm text-frost">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
