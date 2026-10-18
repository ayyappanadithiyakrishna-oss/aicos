/**
 * Deterministic relevance ranking. Inputs and weights are documented and exposed in the ranking
 * debug panel. Extreme predicted moves are deliberately capped so poorly supported "wild calls"
 * cannot dominate the feed.
 */
import type { IntelligenceEvent, RelevanceBreakdown } from "@/lib/domain/types";

export const RANKING_WEIGHTS = {
  exposureBreadth: 0.16,
  novelty: 0.14,
  magnitude: 0.16,
  evidenceQuality: 0.2,
  recency: 0.16,
  responseVsVol: 0.1,
  watchlist: 0.08,
} as const;

/** Recency half-life in hours. */
export const RECENCY_HALF_LIFE_H = 18;

const CAP_BUCKET: Record<string, number> = { mega: 1, large: 0.8, mid: 0.55, small: 0.35 };

export function relevance(
  ev: Pick<IntelligenceEvent, "exposures" | "novelty" | "quality" | "firstPublishedAt" | "forecasts" | "macro" | "earnings" | "severity">,
  opts: { now: Date; watchlist?: ReadonlySet<string>; prioritize?: "market" | "watchlist"; capBuckets?: Record<string, string | null> },
): RelevanceBreakdown {
  const W = { ...RANKING_WEIGHTS } as Record<keyof typeof RANKING_WEIGHTS, number>;
  if (opts.prioritize === "watchlist") {
    W.watchlist = 0.3;
    W.exposureBreadth = 0.08;
  }
  const total = Object.values(W).reduce((a, b) => a + b, 0);

  const breadthRaw = ev.exposures.reduce((acc, e) => {
    const cap = opts.capBuckets?.[e.securityId];
    const w = e.ticker && cap ? (CAP_BUCKET[cap] ?? 0.4) : 0.6; // ETFs / proxies count as broad
    return acc + (e.directness === "direct" ? 1 : 0.5) * w;
  }, 0);
  const exposureBreadth = Math.min(1, breadthRaw / 2.5);
  const novelty = ev.novelty.score;
  const z = ev.macro?.surpriseZ ?? ev.earnings?.surpriseZ ?? null;
  const magnitude = z !== null ? Math.min(1, Math.abs(z) / 2.5) : ev.severity === "high" ? 0.6 : ev.severity === "medium" ? 0.4 : 0.2;
  const evidenceQuality = ev.quality.score / 100;
  const ageH = Math.max(0, (opts.now.getTime() - Date.parse(ev.firstPublishedAt)) / 3_600_000);
  const recency = Math.pow(0.5, ageH / RECENCY_HALF_LIFE_H);
  // Estimated response relative to normal volatility, capped at 1.5σ so wild calls cannot dominate.
  const ratios = ev.forecasts
    .filter((f) => f.centralMovePct !== null && f.neutralBandPct)
    .map((f) => Math.min(1.5, Math.abs(f.centralMovePct!) / (2 * f.neutralBandPct!)) / 1.5);
  const responseVsVol = ratios.length ? Math.max(...ratios) : 0;
  const watch = opts.watchlist && ev.exposures.some((e) => opts.watchlist!.has(e.ticker)) ? 1 : 0;

  const parts = {
    exposureBreadth: { value: exposureBreadth, note: "Market-cap-weighted directness of supported exposures" },
    novelty: { value: novelty, note: "Original disclosure vs. echo of earlier reports" },
    magnitude: { value: magnitude, note: z !== null ? "Measured surprise |z| / 2.5" : "Severity proxy (no measured surprise)" },
    evidenceQuality: { value: evidenceQuality, note: "Event-quality indicator" },
    recency: { value: recency, note: `Half-life ${RECENCY_HALF_LIFE_H}h` },
    responseVsVol: { value: responseVsVol, note: "Estimated response / normal volatility, capped" },
    watchlist: { value: watch, note: "Matches a watchlist ticker" },
  } as const;
  const components: RelevanceBreakdown["components"] = {};
  let score = 0;
  for (const [k, v] of Object.entries(parts)) {
    const weight = W[k as keyof typeof W] / total;
    const contribution = weight * v.value;
    score += contribution;
    components[k] = { value: round3(v.value), weight: round3(weight), contribution: round3(contribution), note: v.note };
  }
  return { score: round3(score * 100), components };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
