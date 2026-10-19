"use client";
/**
 * TradingView Advanced Chart widget, themed to the Apple palette and following light/dark mode.
 * The widget renders in TradingView's own iframe with TradingView's data; attribution is required.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

export function TradingViewChart({ symbol, height = 420, interval = "D", range = "6M" }: { symbol: string; height?: number; interval?: string; range?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => "light" as Theme);
  const key = `${symbol}|${theme}|${interval}|${range}`;
  const [loaded, setLoaded] = useState("");
  const ready = loaded === key;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    el.appendChild(widget);
    const dark = theme === "dark";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.text = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      range,
      timezone: "America/New_York",
      theme,
      style: "3",
      locale: "en",
      backgroundColor: dark ? "#1c1c1e" : "#ffffff",
      gridColor: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
      hide_side_toolbar: true,
      hide_volume: false,
      withdateranges: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      details: false,
      hotlist: false,
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(script);
    const obs = new MutationObserver(() => {
      const frame = el.querySelector("iframe");
      if (frame) {
        frame.addEventListener("load", () => setLoaded(key), { once: true });
        obs.disconnect();
      }
    });
    obs.observe(el, { childList: true, subtree: true });
    const fallback = setTimeout(() => setLoaded(key), 6000);
    return () => {
      obs.disconnect();
      clearTimeout(fallback);
      el.innerHTML = "";
    };
  }, [symbol, theme, interval, range, key]);

  return (
    <figure className="m-0">
      <div className="relative overflow-hidden rounded-xl bg-surface" style={{ height }}>
        {!ready ? <div className="skeleton absolute inset-0 rounded-xl" aria-hidden /> : null}
        <div ref={host} className="tradingview-widget-container relative size-full" aria-label={`Interactive ${symbol} chart from TradingView`} />
      </div>
      <figcaption className="mt-1.5 text-2xs text-ink-3">
        Chart and prices by{" "}
        <a href={`https://www.tradingview.com/symbols/${symbol.replace(":", "-")}/`} target="_blank" rel="noopener noreferrer nofollow" className="text-ink-2 underline underline-offset-2">
          TradingView
        </a>
        . Exchange data may be delayed. Times in America/New_York.
      </figcaption>
    </figure>
  );
}
