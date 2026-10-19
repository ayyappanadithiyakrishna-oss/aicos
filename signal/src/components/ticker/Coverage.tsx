import { relative } from "@/lib/format";
import type { TickerView } from "@/lib/data/views";

function Tone({ s }: { s: number | null }) {
  if (s === null) return null;
  const label = s > 0.15 ? "Positive" : s < -0.15 ? "Negative" : "Neutral";
  const cls = s > 0.15 ? "bg-pos-dim text-pos" : s < -0.15 ? "bg-neg-dim text-neg" : "bg-surface-3 text-ink-2";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium ${cls}`}>{label}</span>;
}

/** Latest vendor-tagged coverage for one ticker with vendor sentiment (Massive insights). */
export function Coverage({ coverage, sentiment, asOf }: { coverage: NonNullable<TickerView["coverage"]>; sentiment: TickerView["sentiment"]; asOf: string }) {
  if (!coverage.length) return <p className="text-xs text-ink-3">No tagged articles in the last two weeks, or the news provider is rate-limited right now.</p>;
  return (
    <div>
      {sentiment ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
          <span>
            <span className="num font-semibold text-ink">{coverage.length}</span> articles in 14 days
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
