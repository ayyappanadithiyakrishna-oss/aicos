"use client";
import { useEffect, useState } from "react";
import { relative } from "@/lib/format";
import type { TickerView } from "@/lib/data/views";

function Tone({ s }: { s: number | null }) {
  if (s === null) return null;
  const label = s > 0.15 ? "Positive" : s < -0.15 ? "Negative" : "Neutral";
  const cls = s > 0.15 ? "bg-pos-dim text-pos" : s < -0.15 ? "bg-neg-dim text-neg" : "bg-surface-3 text-ink-2";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium ${cls}`}>{label}</span>;
}

/** Latest vendor-tagged coverage for one ticker with vendor sentiment (Massive insights). */
export function Coverage({ coverage: initial, sentiment: initialSentiment, asOf, ticker }: { coverage: NonNullable<TickerView["coverage"]>; sentiment: TickerView["sentiment"]; asOf: string; ticker?: string }) {
  const [result, setResult] = useState<{ ticker: string; coverage: typeof initial; sentiment: typeof initialSentiment } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">(initial.length ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (initial.length || !ticker) return;
    const ctrl = new AbortController();
    fetch(`/api/coverage/${encodeURIComponent(ticker)}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("News unavailable");
        const d = await r.json();
        if (!ctrl.signal.aborted) { setResult({ ticker, coverage: d.coverage, sentiment: d.sentiment }); setState("ready"); }
      })
      .catch(() => { if (!ctrl.signal.aborted) setState("error"); });
    return () => ctrl.abort();
  }, [initial.length, ticker, attempt]);
  const current = result?.ticker === ticker ? result : null;
  const coverage = initial.length ? initial : current?.coverage ?? [];
  const sentiment = initial.length ? initialSentiment : current?.sentiment;
  if (!coverage.length && state === "loading" && ticker) return <div aria-busy="true" aria-label="Loading ticker coverage" className="space-y-3"><div className="skeleton h-4 w-3/4" /><div className="skeleton h-4 w-2/3" /><p className="text-xs text-ink-3">Retrieving the latest coverage…</p></div>;
  if (!coverage.length && state === "error") return <div><p className="text-xs text-ink-3">The news provider is busy. Your price chart and other data are still available.</p><button type="button" className="mt-2 cursor-pointer text-xs text-accent underline underline-offset-2" onClick={() => { setState("loading"); setAttempt((x) => x + 1); }}>Retry coverage</button></div>;
  if (!coverage.length) return <p className="text-xs text-ink-3">No tagged articles in the last two weeks, or the news provider is rate-limited right now.</p>;
  return (
    <div>
      {sentiment ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
          <span>
            <span className="num font-semibold text-ink">{coverage.length}</span> latest articles · 14-day window
          </span>
          <span>
            <span className="num font-semibold text-pos">{sentiment.positive}</span> positive · <span className="num font-semibold text-neg">{sentiment.negative}</span> negative ·{" "}
            <span className="num">{sentiment.n - sentiment.positive - sentiment.negative}</span> neutral
          </span>
          <span className="text-ink-3">Net tone {sentiment.mean > 0 ? "+" : ""}{sentiment.mean.toFixed(2)} (vendor sentiment, −1 to +1)</span>
        </div>
      ) : null}
      <ul className="divide-y divide-line">
        {coverage.slice(0, 10).map((c) => (
          <li key={c.url} className="flex items-start gap-3 py-2.5 first:pt-0">
            <div className="min-w-0 flex-1">
              <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="line-clamp-2 text-sm text-ink hover:text-accent">
                {c.title}
              </a>
              <div className="mt-0.5 text-2xs text-ink-3">
                {c.publisher} · {relative(c.publishedAt, asOf)}
                {c.note ? <span className="text-ink-3"> · {c.note}</span> : null}
              </div>
            </div>
            <Tone s={c.sentiment} />
          </li>
        ))}
      </ul>
    </div>
  );
}
