"use client";
/**
 * Price chart (lightweight-charts) with zoom/pan, exchange-time axis and event markers placed at
 * ACTUAL publication timestamps. Source and delay are always printed under the chart.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { PriceBar } from "@/lib/domain/types";

export interface ChartMarker {
  at: string;
  label: string;
  severity: "high" | "medium" | "low";
}

const etDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const etDate = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const etFull = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export function PriceChart({
  daily,
  intraday,
  markers,
  sourceLabel,
  height = 320,
  defaultView,
}: {
  daily: PriceBar[];
  intraday: PriceBar[];
  markers: ChartMarker[];
  sourceLabel: string;
  height?: number;
  defaultView?: "daily" | "intraday";
}) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [view, setView] = useState<"daily" | "intraday">(defaultView ?? (intraday.length ? "intraday" : "daily"));
  const [theme, setTheme] = useState(0);
  const bars = view === "daily" ? daily : intraday;

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const summary = useMemo(() => {
    if (!bars.length) return "No price data available.";
    const first = bars[0]!;
    const last = bars[bars.length - 1]!;
    return `${view === "daily" ? "Daily" : "30-minute"} bars from ${etFull.format(new Date(first.t))} to ${etFull.format(new Date(last.t))} ET; last close ${last.c.toFixed(2)}.`;
  }, [bars, view]);

  useEffect(() => {
    if (!el.current || !bars.length) return;
    const ink3 = cssVar("--ink-3");
    const line = cssVar("--line");
    const chart = createChart(el.current, {
      autoSize: true,
      height,
      layout: { background: { color: "transparent" }, textColor: ink3, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, system-ui, sans-serif", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: line } },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: view === "intraday",
        secondsVisible: false,
        // Day boundaries show the date; intraday ticks show exchange time.
        tickMarkFormatter: (t: Time, type: number) => (typeof t === "number" ? (type < 3 ? etDate.format(new Date(t * 1000)) : etTime.format(new Date(t * 1000))) : null),
      },
      localization: {
        timeFormatter: (t: Time) => (typeof t === "number" ? `${etFull.format(new Date(t * 1000))} ET` : String(t)),
      },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;
    const toTime = (b: PriceBar): Time => (view === "daily" ? (etDay.format(new Date(b.t)) as Time) : (Math.floor(Date.parse(b.t) / 1000) as UTCTimestamp));
    const pos = cssVar("--pos");
    const neg = cssVar("--neg");
    const series =
      view === "daily"
        ? chart.addSeries(CandlestickSeries, { upColor: pos, downColor: neg, borderVisible: false, wickUpColor: pos, wickDownColor: neg, priceLineVisible: false })
        : chart.addSeries(LineSeries, { color: cssVar("--accent"), lineWidth: 2, priceLineVisible: false });
    if (view === "daily") series.setData(bars.map((b) => ({ time: toTime(b), open: b.o, high: b.h, low: b.l, close: b.c })) as never);
    else series.setData(bars.map((b) => ({ time: toTime(b), value: b.c })) as never);
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, color: cssVar("--line-2"), priceLineVisible: false, lastValueVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(bars.map((b) => ({ time: toTime(b), value: b.v })) as never);

    // Snap each event to the first bar whose close is at/after the publication time.
    const ms = bars.map((b) => Date.parse(b.t));
    const ms0 = ms[0]!;
    const ms1 = ms[ms.length - 1]!;
    const placed: SeriesMarker<Time>[] = [];
    for (const m of markers) {
      const t = Date.parse(m.at);
      if (t < ms0 - 86_400_000 || t > ms1 + 3_600_000) continue;
      const i = ms.findIndex((x) => x >= t);
      if (i < 0) continue;
      placed.push({ time: toTime(bars[i]!), position: "aboveBar", shape: "circle", color: m.severity === "high" ? cssVar("--accent") : cssVar("--ink-2"), text: m.label, size: m.severity === "high" ? 1.2 : 0.8 });
    }
    placed.sort((a, b) => (String(a.time) < String(b.time) ? -1 : 1));
    createSeriesMarkers(series, placed);
    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, markers, view, height, theme]);

  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Chart resolution" className="inline-flex rounded-full bg-surface-3 p-0.5">
          {(["intraday", "daily"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              disabled={v === "intraday" ? !intraday.length : !daily.length}
              onClick={() => setView(v)}
              className={clsx("h-6 cursor-pointer rounded-full px-3 text-2xs font-medium disabled:cursor-not-allowed disabled:opacity-40", view === v ? "bg-surface text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-ink-2 hover:text-ink")}
            >
              {v === "intraday" ? "30-min · 10 sessions" : "Daily · 1 year"}
            </button>
          ))}
        </div>
        <span className="text-2xs text-ink-3">Scroll to zoom · drag to pan · dots mark actual publication times</span>
      </div>
      {bars.length ? <div ref={el} style={{ height }} className="w-full" aria-label={summary} role="img" /> : <div className="flex items-center justify-center rounded-md border border-dashed border-line-2 text-sm text-ink-3" style={{ height }}>No price data available for this resolution.</div>}
      <figcaption className="mt-1.5 text-2xs text-ink-3">
        <span className="sr-only">{summary} </span>
        Source: {sourceLabel}. Times in America/New_York.
      </figcaption>
    </figure>
  );
}
