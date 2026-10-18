/**
 * FRED / ALFRED adapter. Provides official observations and vintages; it does NOT provide survey
 * consensus, so surprises are never computed from FRED alone. Release time-of-day is not in FRED;
 * releases are stamped with the agency's published schedule time (08:30 ET) and flagged as such.
 */
import type { RawRecord } from "@/lib/ingestion/types";
import { zonedToUtc } from "@/lib/calendar/time";
import { ProviderError, providerJson } from "./http";

export interface FredSeriesSpec {
  id: string;
  indicator: string;
  unit: string;
  transform: "yoy" | "mom_pct" | "diff_k" | "level";
  agency: string;
}

export const FRED_SERIES: FredSeriesSpec[] = [
  { id: "CPIAUCSL", indicator: "CPI", unit: "%", transform: "yoy", agency: "BLS" },
  { id: "PCEPILFE", indicator: "Core PCE", unit: "%", transform: "yoy", agency: "BEA" },
  { id: "PAYEMS", indicator: "Nonfarm Payrolls", unit: "K", transform: "diff_k", agency: "BLS" },
  { id: "UNRATE", indicator: "Unemployment Rate", unit: "%", transform: "level", agency: "BLS" },
  { id: "RSAFS", indicator: "Retail Sales (MoM)", unit: "%", transform: "mom_pct", agency: "Census" },
];

interface FredObs {
  date: string;
  value: string;
  realtime_start: string;
}

function transform(spec: FredSeriesSpec, obs: Array<{ date: string; v: number }>, i: number): number | null {
  const cur = obs[i];
  if (!cur) return null;
  const round = (x: number) => Math.round(x * 10) / 10;
  if (spec.transform === "level") return cur.v;
  if (spec.transform === "diff_k") return i >= 1 ? Math.round(cur.v - obs[i - 1]!.v) : null;
  if (spec.transform === "mom_pct") return i >= 1 ? round(((cur.v / obs[i - 1]!.v) - 1) * 100) : null;
  return i >= 12 ? round(((cur.v / obs[i - 12]!.v) - 1) * 100) : null;
}

export interface FredRelease {
  spec: FredSeriesSpec;
  period: string;
  actual: number;
  prior: number | null;
  revisedPrior: number | null;
  releaseDate: string;
}

async function observations(apiKey: string, seriesId: string, realtime: string | null, fetchImpl?: typeof fetch): Promise<FredObs[]> {
  const p = new URLSearchParams({ series_id: seriesId, api_key: apiKey, file_type: "json", observation_start: "2023-01-01" });
  if (realtime) {
    p.set("realtime_start", realtime);
    p.set("realtime_end", realtime);
  }
  const data = await providerJson<{ observations?: FredObs[] }>(`https://api.stlouisfed.org/fred/series/observations?${p}`, { provider: "fred", ratePerSec: 2, revalidate: 3600, fetchImpl });
  if (!Array.isArray(data.observations)) throw new ProviderError("fred", "schema", "Missing observations array");
  return data.observations;
}

/** Latest release for a series, with the prior as first known and as revised (vintage-aware). */
export async function latestRelease(apiKey: string, spec: FredSeriesSpec, fetchImpl?: typeof fetch): Promise<FredRelease | null> {
  const latest = (await observations(apiKey, spec.id, null, fetchImpl)).filter((o) => o.value !== ".").map((o) => ({ date: o.date, v: Number(o.value), rt: o.realtime_start }));
  if (latest.length < 14) return null;
  const i = latest.length - 1;
  const actual = transform(spec, latest, i);
  if (actual === null) return null;
  const releaseDate = latest[i]!.rt;
  // Vintage the day before the latest release: what the prior period looked like at the time.
  const dayBefore = new Date(Date.parse(`${releaseDate}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  let prior: number | null = null;
  try {
    const vint = (await observations(apiKey, spec.id, dayBefore, fetchImpl)).filter((o) => o.value !== ".").map((o) => ({ date: o.date, v: Number(o.value) }));
    prior = transform(spec, vint, vint.length - 1);
  } catch {
    prior = null;
  }
  return { spec, period: latest[i]!.date.slice(0, 7), actual, prior, revisedPrior: transform(spec, latest, i - 1), releaseDate };
}

export function releaseToRecord(r: FredRelease, fetchedAt: string): RawRecord {
  const at = zonedToUtc(r.releaseDate, 8, 30).toISOString();
  return {
    provider: "fred",
    providerId: `${r.spec.id}:${r.period}:${r.releaseDate}`,
    kind: "macro_release",
    url: `https://fred.stlouisfed.org/series/${r.spec.id}`,
    title: `${r.spec.indicator} (${r.period}) ${r.spec.unit === "K" ? `${r.actual}K` : `${r.actual}${r.spec.unit}`} per ${r.spec.agency} via FRED`,
    excerpt: `${r.spec.agency} release via FRED: ${r.spec.indicator} ${r.actual}${r.spec.unit === "K" ? "K" : r.spec.unit}; prior ${r.prior ?? "n/a"}. Release time assumed from the agency schedule (08:30 ET); FRED provides dates only. No licensed consensus.`,
    contentScope: "title_only",
    publisher: `${r.spec.agency} via FRED`,
    sourceId: "fred",
    publishedAt: at,
    fetchedAt,
    tickers: [],
    isOriginalDisclosure: true,
    isSynthetic: false,
    structured: { macro: { indicator: r.spec.indicator, period: r.period, unit: r.spec.unit, actual: r.actual, prior: r.prior, revisedPrior: r.revisedPrior, consensus: null, historicalErrors: [] } },
    internalPath: null,
  };
}
