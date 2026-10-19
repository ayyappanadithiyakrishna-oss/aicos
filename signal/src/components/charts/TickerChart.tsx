"use client";
/**
 * Price panel: TradingView for real listings, with SIGNAL's own event-marker chart one tap away.
 * Synthetic demo tickers only have the event-marker chart.
 */
import { useState } from "react";
import clsx from "clsx";
import type { PriceBar } from "@/lib/domain/types";
import { PriceChart, type ChartMarker } from "./PriceChart";
import { TradingViewChart } from "./TradingViewChart";

export function TickerChart({
  tvSymbol,
  daily,
  intraday,
  markers,
  sourceLabel,
  height = 420,
}: {
  tvSymbol: string | null;
  daily: PriceBar[];
  intraday: PriceBar[];
  markers: ChartMarker[];
  sourceLabel: string;
  height?: number;
}) {
  const [view, setView] = useState<"tv" | "events">(tvSymbol ? "tv" : "events");
  if (!tvSymbol) return <PriceChart daily={daily} intraday={intraday} markers={markers} sourceLabel={sourceLabel} height={Math.min(height, 320)} />;
  return (
    <div>
      <div role="tablist" aria-label="Chart type" className="mb-3 inline-flex rounded-full bg-surface-3 p-0.5">
        {(
          [
            ["tv", "Chart"],
            ["events", `Event markers${markers.length ? ` · ${markers.length}` : ""}`],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={clsx("h-7 cursor-pointer rounded-full px-3.5 text-xs font-medium", view === v ? "bg-surface text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-ink-2 hover:text-ink")}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "tv" ? <TradingViewChart symbol={tvSymbol} height={height} /> : <PriceChart daily={daily} intraday={intraday} markers={markers} sourceLabel={sourceLabel} height={Math.min(height, 340)} />}
    </div>
  );
}
