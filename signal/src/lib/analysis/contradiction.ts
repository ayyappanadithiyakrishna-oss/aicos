/**
 * Contradiction engine. Distinguishes conflict between SOURCES, conflict between MODELS
 * (horizons disagree), disagreement between the model and the observed MARKET reaction, and
 * counter-MECHANISMS that could reverse the expected move. Never claims a "sure reversal".
 */
import type { Contradiction, ForecastRealization, ForecastSnapshot, MechanismGraph } from "@/lib/domain/types";
import { hashHex } from "@/lib/quant/stats";

export function findContradictions(args: {
  eventId: string;
  counterMechanisms: string[];
  invalidation: string[];
  sourceConflicts: Array<{ text: string; evidenceIds: string[] }>;
  forecasts: ForecastSnapshot[];
  observed: Array<{ ticker: string; rawPct: number | null; forecast: ForecastSnapshot | null }>;
  graph: MechanismGraph;
}): Contradiction[] {
  const out: Contradiction[] = [];
  const id = (s: string) => `cx_${hashHex(`${args.eventId}|${s}`)}`;
  for (const c of args.sourceConflicts) {
    out.push({ id: id(c.text), kind: "source_conflict", text: c.text, falsifier: "An original disclosure that resolves which report is correct.", evidenceIds: c.evidenceIds });
  }
  // Model conflict: same asset, opposite-signed central estimates across horizons.
  const byAsset = new Map<string, ForecastSnapshot[]>();
  for (const f of args.forecasts) {
    if (f.centralMovePct === null) continue;
    const arr = byAsset.get(f.ticker) ?? [];
    arr.push(f);
    byAsset.set(f.ticker, arr);
  }
  for (const [ticker, fs] of byAsset) {
    const pos = fs.find((f) => f.centralMovePct! > 0);
    const neg = fs.find((f) => f.centralMovePct! < 0);
    if (pos && neg) {
      out.push({
        id: id(`model:${ticker}`),
        kind: "model_conflict",
        text: `Horizon models disagree on ${ticker}: ${pos.horizon} estimate is positive while ${neg.horizon} is negative.`,
        falsifier: `Which horizon's sign the realized ${ticker} reaction matches.`,
        evidenceIds: [],
      });
    }
  }
  // Market disagreement: observed move already opposite to the model's direction beyond its band.
  for (const o of args.observed) {
    const f = o.forecast;
    if (!f || o.rawPct === null || f.centralMovePct === null || f.neutralBandPct === null) continue;
    if (Math.sign(o.rawPct) !== Math.sign(f.centralMovePct) && Math.abs(o.rawPct) > f.neutralBandPct) {
      out.push({
        id: id(`mkt:${o.ticker}`),
        kind: "market_disagreement",
        text: `${o.ticker} has so far moved against the modeled direction. Possible explanations: the surprise was anticipated, a concurrent catalyst dominates, or the mechanism is weaker than history implies.`,
        falsifier: `Persistence of the ${o.ticker} move through the ${f.horizon} window.`,
        evidenceIds: [],
      });
    }
  }
  args.counterMechanisms.forEach((t, i) => {
    out.push({ id: id(`counter:${i}`), kind: "counter_mechanism", text: t, falsifier: args.invalidation[i] ?? args.invalidation[0] ?? "Contradicting price action in the exposed assets.", evidenceIds: [] });
  });
  // Hypothesized edges are themselves open to dispute.
  const hyp = args.graph.edges.filter((e) => e.hypothesized).length;
  if (hyp >= 2) {
    out.push({ id: id("hyp"), kind: "counter_mechanism", text: `${hyp} links in the transmission map are hypothesized rather than documented.`, falsifier: "Documented relationship data or observed co-movement confirming the links.", evidenceIds: [] });
  }
  return out;
}

export function realizedVsForecast(f: ForecastSnapshot, r: ForecastRealization | undefined) {
  if (!r || r.status !== "resolved" || r.abnormalReturnPct === null) return null;
  return {
    hit: f.centralMovePct === null ? null : Math.sign(f.centralMovePct) === Math.sign(r.abnormalReturnPct),
    insideInterval: f.intervalLowPct === null ? null : r.abnormalReturnPct >= f.intervalLowPct && r.abnormalReturnPct <= f.intervalHighPct!,
  };
}
