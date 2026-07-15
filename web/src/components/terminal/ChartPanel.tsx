"use client";

import { useEffect, useRef, useState } from "react";
import { CandlestickChart } from "lucide-react";

/* TradingView Advanced Chart embed. Loads the official widget script and
   renders a dark, hairline chart matching the Scale canvas. Falls back to
   a quiet skeleton if the script can't load (e.g. offline). */
export function ChartPanel({ symbol }: { symbol: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.innerHTML = "";
    setFailed(false);

    const container = document.createElement("div");
    container.className = "tradingview-widget-container__widget h-full w-full";
    el.appendChild(container);

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.type = "text/javascript";
    script.onerror = () => setFailed(true);
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: `NASDAQ:${symbol}`,
      interval: "D",
      timezone: "America/New_York",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "rgba(10, 10, 12, 1)",
      gridColor: "rgba(38, 38, 38, 0.4)",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(script);

    const timeout = setTimeout(() => {
      if (!el.querySelector("iframe")) setFailed(true);
    }, 4000);

    return () => clearTimeout(timeout);
  }, [symbol]);

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="h-full w-full [&_iframe]:rounded-images" />
      {failed && <ChartSkeleton symbol={symbol} />}
    </div>
  );
}

function ChartSkeleton({ symbol }: { symbol: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <svg
        viewBox="0 0 400 160"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full opacity-40"
      >
        <polyline
          points="0,120 40,110 80,124 120,90 160,98 200,70 240,82 280,52 320,64 360,40 400,48"
          fill="none"
          stroke="url(#g)"
          strokeWidth="1.5"
        />
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="400" y2="0">
            <stop offset="0%" stopColor="#d1aad7" />
            <stop offset="100%" stopColor="#bbdef2" />
          </linearGradient>
        </defs>
      </svg>
      <div className="relative z-10 flex flex-col items-center gap-2 text-center">
        <CandlestickChart className="h-6 w-6 text-mute" strokeWidth={1.25} />
        <p className="text-caption text-ash">
          Live chart for <span className="mono text-frost">{symbol}</span>
        </p>
        <p className="text-[11px] text-mute">TradingView feed connecting…</p>
      </div>
    </div>
  );
}
