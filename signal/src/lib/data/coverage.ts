import type { RawRecord } from "@/lib/ingestion/types";
import type { TickerView } from "./views";
import { canonicalUrl } from "@/lib/analysis/canonicalize";
import { PROMOTIONAL } from "@/lib/ingestion/pipeline";

/** One definition of coverage, de-duplication and sentiment buckets for page and recovery endpoint. */
export function tickerCoverage(records: RawRecord[], ticker: string) {
  const seen = new Set<string>();
  const coverage: NonNullable<TickerView["coverage"]> = [];
  for (const n of records) {
    const key = canonicalUrl(n.url);
    if (seen.has(key) || PROMOTIONAL.test(n.title)) continue;
    seen.add(key);
    const s = n.vendorSentiment?.find((x) => x.ticker === ticker) ?? null;
    coverage.push({ title: n.title, url: n.url, publisher: n.publisher, publishedAt: n.publishedAt ?? n.fetchedAt, sentiment: s?.score ?? null, note: s?.note ?? "" });
  }
  const scored = coverage.filter((c) => c.sentiment !== null);
  const sentiment = scored.length ? { mean: Math.round(scored.reduce((x, c) => x + c.sentiment!, 0) / scored.length * 100) / 100, n: scored.length, positive: scored.filter((c) => c.sentiment! > 0.15).length, negative: scored.filter((c) => c.sentiment! < -0.15).length } : null;
  return { coverage, sentiment };
}
