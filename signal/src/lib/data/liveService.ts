/**
 * LIVE data service. Reads from the repository populated by ingestion jobs. With no database
 * (ephemeral memory store) it refreshes on demand at most every LIVE_REFRESH_SECONDS. It never
 * falls back to demo data: empty or failed upstreams produce explicit empty/outage states.
 */
import type { IntelligenceEvent } from "@/lib/domain/types";
import { marketClock } from "@/lib/calendar/nyse";
import { getRepository } from "@/lib/db/client";
import { computeMacroSurprise } from "@/lib/analysis/macro";
import { buildScorecard, type ScoredRow } from "@/lib/quant/evaluate";
import { quantile } from "@/lib/quant/stats";
import { logReturnPct } from "@/lib/quant/returns";
import { minMetricSample } from "@/lib/config/env";
import { FRED_SERIES, latestRelease } from "@/lib/providers/fred";
import { blsReleases } from "@/lib/providers/free";
import { liveMaster, runLiveIngest, type IngestReport } from "@/lib/live/jobs";
import { LivePriceStore } from "@/lib/live/prices";
import { LIVE_PROXIES } from "@/lib/live/master";
import { anyLiveProvider, liveConfig, liveProviderViews, priceProvider } from "@/lib/live/registry";
import { decodeCursor, encodeCursor, queryFeed } from "./feedQuery";
import type { ArchiveQuery, ArchiveView, CalendarItem, FeedQuery, FeedResult, MacroRow, MarketPulseView, ModeInfo, PulseRibbonItem, ScorecardView, SearchHit, StatusView, TickerView, EarningsRow, FilingRow } from "./views";

let lastReport: IngestReport | null = null;
let lastRunAt = 0;
let inflight: Promise<IngestReport> | null = null;

function modeInfo(now: Date): ModeInfo {
  const cfg = liveConfig();
  const pp = priceProvider(cfg);
  return {
    mode: "live",
    asOf: now.toISOString(),
    clock: marketClock(now),
    label: anyLiveProvider(cfg) ? "LIVE" : "LIVE · NO PROVIDERS CONFIGURED",
    priceEntitlement: pp ? "delayed" : "none",
    priceSource: pp ? new LivePriceStore(cfg).source : "No licensed price provider configured",
    demoReason: null,
  };
}

/** On-demand refresh only for the ephemeral store; with Postgres, cron owns ingestion. */
export async function ensureFresh(now = new Date()): Promise<IngestReport | null> {
  const repo = getRepository();
  if (repo.kind !== "memory") return lastReport;
  const ttl = Number(process.env.LIVE_REFRESH_SECONDS ?? 300) * 1000;
  if (now.getTime() - lastRunAt < ttl && lastReport) return lastReport;
  if (!inflight) {
    inflight = runLiveIngest({ now, repo, trigger: "on_demand" })
      .then((r) => {
        lastReport = r;
        lastRunAt = Date.now();
        return r;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function recordReport(r: IngestReport) {
  lastReport = r;
  lastRunAt = Date.now();
}

async function events(): Promise<IntelligenceEvent[]> {
  await ensureFresh();
  return getRepository().listEvents(300);
}

export async function liveFeed(q: FeedQuery): Promise<FeedResult> {
  const now = new Date();
  const evs = await events();
  const lags = lastReport?.ingestLagMinutes ?? [];
  const newest = evs.reduce<string | null>((m, e) => (!m || e.firstPublishedAt > m ? e.firstPublishedAt : m), null);
  return {
    mode: modeInfo(now),
    ...queryFeed(evs, q, now),
    freshness: {
      lastIngestAt: lastReport?.finishedAt ?? null,
      newestItemAt: newest,
      ingestLagP50Min: lags.length ? Math.round(quantile(lags, 0.5) * 10) / 10 : null,
      ingestLagP95Min: lags.length ? Math.round(quantile(lags, 0.95) * 10) / 10 : null,
      stale: lastReport ? now.getTime() - Date.parse(lastReport.finishedAt) > 30 * 60_000 : true,
      note: lastReport?.reason ?? (lastReport ? "Measured from provider publication to ingestion." : "No ingestion has run on this instance yet."),
    },
  };
}

export async function liveEvent(id: string) {
  await ensureFresh();
  const event = await getRepository().getEvent(id);
  if (!event) return null;
  const all = await getRepository().listEvents(300);
  const tickers = new Set(event.exposures.map((x) => x.ticker));
  return { mode: modeInfo(new Date()), event, related: all.filter((e) => e.id !== id && e.exposures.some((x) => tickers.has(x.ticker))).slice(0, 6) };
}

export async function liveRibbon(): Promise<{ mode: ModeInfo; items: PulseRibbonItem[] }> {
  const now = new Date();
  const cfg = liveConfig();
  const prices = new LivePriceStore(cfg);
  const list = LIVE_PROXIES.filter((p) => ["SPY", "QQQ", "IWM", "TLT", "UUP"].includes(p.ticker));
  await prices.prefetch(list, now);
  return {
    mode: modeInfo(now),
    items: list.map((p) => {
      const b = prices.daily(p.id);
      const last = b?.at(-1) ?? null;
      const prev = b && b.length > 1 ? b.at(-2)! : null;
      return {
        ticker: p.ticker,
        label: p.name,
        last: last?.c ?? null,
        changePct: last && prev ? Math.round(logReturnPct(prev.c, last.c) * 100) / 100 : null,
        asOf: last?.t ?? null,
        entitlement: last ? "delayed" : "none",
        note: last ? "End-of-day, delayed" : "No entitled price feed",
      };
    }),
  };
}

export async function liveTicker(symbol: string): Promise<TickerView | null> {
  const now = new Date();
  const cfg = liveConfig();
  const master = await liveMaster(cfg);
  const sec = master.byTicker(symbol.toUpperCase());
  if (!sec) return null;
  const prices = new LivePriceStore(cfg);
  await prices.prefetch([sec], now, 1);
  const daily = prices.daily(sec.id) ?? [];
  const evs = (await events()).filter((e) => e.exposures.some((x) => x.securityId === sec.id));
  const repo = getRepository();
  const fs = (await repo.allForecasts({ limit: 1000 })).filter((f) => f.securityId === sec.id && f.horizon === "next_session");
  const rz = await repo.realizationsFor(fs.map((f) => f.id));
  const last = daily.at(-1) ?? null;
  const prev = daily.length > 1 ? daily.at(-2)! : null;
  return {
    mode: modeInfo(now),
    security: sec,
    quote: { securityId: sec.id, ticker: sec.ticker, last: last?.c ?? null, changePct: last && prev ? Math.round(logReturnPct(prev.c, last.c) * 100) / 100 : null, asOf: last?.t ?? null, entitlement: last ? "delayed" : "none", delayMinutes: null, source: prices.source },
    daily: daily.slice(-260),
    intraday: [],
    markers: evs.map((e) => ({ at: e.firstPublishedAt, eventId: e.id, label: e.subtype.split(".").pop()!.replace(/_/g, " "), severity: e.severity })),
    events: evs,
    impactHistory: fs.slice(0, 40).map((f) => {
      const r = rz.get(f.id);
      const ar = r?.status === "resolved" ? r.abnormalReturnPct : null;
      return { forecastId: f.id, eventId: f.eventId, eventTitle: evs.find((e) => e.id === f.eventId)?.originalTitle ?? f.eventId, generatedAt: f.forecastGeneratedAt, horizon: f.horizon, central: f.centralMovePct, lo: f.intervalLowPct, hi: f.intervalHighPct, direction: f.direction, qualityTier: f.qualityTier, realizedAr: ar, status: r?.status ?? "pending", hit: ar === null || f.centralMovePct === null ? null : Math.sign(ar) === Math.sign(f.centralMovePct), inside: null, sample: "live" };
    }),
    relationships: [],
    memberships: [],
    holdings: [],
    catalysts: [],
    attention: { recent: evs.length, baseline: null, ratio: null, note: "Baseline needs stored history (DATABASE_URL)." },
    trajectory: fs.slice(0, 24).reverse().map((f) => ({ at: f.forecastGeneratedAt, eventId: f.eventId, direction: f.direction, central: f.centralMovePct, tier: f.qualityTier })),
    options: { available: false, reason: "No entitled options data source configured." },
    peers: [],
  };
}

export async function livePulse(): Promise<MarketPulseView> {
  const now = new Date();
  const cfg = liveConfig();
  const prices = new LivePriceStore(cfg);
  await prices.prefetch(LIVE_PROXIES, now);
  const chg = (id: string) => {
    const b = prices.daily(id);
    return b && b.length > 1 ? Math.round(logReturnPct(b.at(-2)!.c, b.at(-1)!.c) * 100) / 100 : null;
  };
  const evs = await events();
  const today = now.toISOString().slice(0, 10);
  return {
    mode: modeInfo(now),
    benchmark: { ticker: "SPY", name: "SPDR S&P 500 ETF Trust", changePct: chg("live:SPY"), intraday: [], prevClose: prices.daily("live:SPY")?.at(-2)?.c ?? null, last: prices.daily("live:SPY")?.at(-1)?.c ?? null },
    breadth: null,
    sectors: [
      { ticker: "XLE", sector: "Energy", changePct: chg("live:XLE") },
      { ticker: "XLF", sector: "Financials", changePct: chg("live:XLF") },
    ],
    crossAsset: [
      { ticker: "TLT", label: "Long Treasuries", changePct: chg("live:TLT"), note: "End-of-day" },
      { ticker: "UUP", label: "US dollar", changePct: chg("live:UUP"), note: "End-of-day" },
      { ticker: "QQQ", label: "Growth equities", changePct: chg("live:QQQ"), note: "End-of-day" },
    ],
    regime: { label: "Unknown", volIndex: null, volTicker: null, note: "Volatility index requires an entitled index feed." },
    drivers: evs.filter((e) => e.firstPublishedAt.startsWith(today)).slice(0, 8).map((e) => ({ eventId: e.id, at: e.firstPublishedAt, title: e.originalTitle, bottomLine: e.bottomLine, hypothesis: e.transmission.join(" → "), observed: [] })),
    volumeAnomalies: [],
    attributionNote: "Live mode without intraday entitlements: observed values are end-of-day; event links are hypotheses, not causal attribution.",
  };
}

export async function liveMacro(): Promise<{ mode: ModeInfo; rows: MacroRow[] }> {
  const now = new Date();
  const cfg = liveConfig();
  const rows: MacroRow[] = [];
  if (cfg.fredKey) {
    for (const spec of FRED_SERIES) {
      try {
        const r = await latestRelease(cfg.fredKey, spec);
        if (!r) continue;
        rows.push({
          id: `${spec.id}-${r.period}`,
          indicator: spec.indicator,
          period: r.period,
          releaseAt: `${r.releaseDate}T12:30:00.000Z`,
          releaseTimeKnown: false,
          status: "released",
          unit: spec.unit,
          actual: r.actual,
          consensus: null,
          consensusSource: null,
          prior: r.prior,
          revisedPrior: r.revisedPrior,
          surprise: computeMacroSurprise({ indicator: spec.indicator, unit: spec.unit, actual: r.actual, prior: r.prior, revisedPrior: r.revisedPrior }, null),
          source: `${spec.agency} via FRED`,
          eventId: null,
          isSynthetic: false,
        });
      } catch {
        // Provider failure is reflected in provider health; no fabricated row.
      }
    }
  }
  if (!rows.length && cfg.free) {
    try {
      for (const r of await blsReleases()) {
        rows.push({
          id: `bls-${r.indicator}-${r.period}`.replace(/\W+/g, "-").toLowerCase(),
          indicator: r.indicator,
          period: r.period,
          releaseAt: now.toISOString(),
          releaseTimeKnown: false,
          status: "released",
          unit: r.unit,
          actual: r.actual,
          consensus: null,
          consensusSource: null,
          prior: r.prior,
          revisedPrior: null,
          surprise: computeMacroSurprise({ indicator: r.indicator, unit: r.unit, actual: r.actual, prior: r.prior, revisedPrior: null }, null),
          source: "BLS public API (latest observation; release date not provided)",
          eventId: null,
          isSynthetic: false,
        });
      }
    } catch {
      // BLS quota or outage: shown on Data Status; nothing fabricated here.
    }
  }
  return { mode: modeInfo(now), rows };
}

export async function liveEarningsAndFilings(): Promise<{ mode: ModeInfo; earnings: EarningsRow[]; filings: FilingRow[] }> {
  const evs = await events();
  const filings: FilingRow[] = evs.flatMap((e) =>
    e.evidence
      .filter((x) => x.kind === "filing")
      .map((x) => ({ id: x.id, ticker: e.exposures.find((y) => y.directness === "direct")?.ticker ?? null, company: e.originalTitle.split(" files ")[0] ?? "", form: /files ([^:]+):/.exec(e.originalTitle)?.[1] ?? "", items: [], acceptedAt: x.publishedAt, accession: "", isAmendment: false, amends: null, link: x.url, eventId: e.id, isSynthetic: false })),
  );
  return { mode: modeInfo(new Date()), earnings: [], filings };
}

export async function liveCalendar(): Promise<CalendarItem[]> {
  return [];
}

export async function liveScorecard(): Promise<ScorecardView> {
  const repo = getRepository();
  const fs = await repo.allForecasts({ limit: 5000 });
  const rz = await repo.realizationsFor(fs.map((f) => f.id));
  const rows: ScoredRow[] = [];
  for (const f of fs) {
    const r = rz.get(f.id);
    if (!r || r.status !== "resolved" || r.abnormalReturnPct === null || !r.outcomeClass || f.qualityTier === "insufficient") continue;
    rows.push({ forecastId: f.id, at: f.forecastGeneratedAt, horizon: f.horizon, sample: "oos", sector: "—", eventKind: "—", regime: "—", direction: f.direction, central: f.centralMovePct, lo: f.intervalLowPct, hi: f.intervalHighPct, probabilities: f.probabilities, realizedAr: r.abnormalReturnPct, outcome: r.outcomeClass, baselines: { zero: 0, eventPrior: 0, marketBeta: 0 }, realizedRaw: r.rawReturnPct ?? 0 });
  }
  return {
    mode: modeInfo(new Date()),
    scorecard: buildScorecard(rows, { climatology: { up: 1 / 3, down: 1 / 3, neutral: 1 / 3 }, minSample: minMetricSample(), generatedAt: new Date().toISOString() }),
    modelVersion: null,
    note: "Live forecasts are out-of-sample by construction. Metrics stay withheld until enough forecasts resolve.",
  };
}

export async function liveArchive(q: ArchiveQuery): Promise<ArchiveView> {
  const repo = getRepository();
  let fs = await repo.allForecasts({ limit: 5000 });
  if (q.ticker) fs = fs.filter((f) => f.ticker === q.ticker!.toUpperCase());
  if (q.horizon) fs = fs.filter((f) => f.horizon === q.horizon);
  const rz = await repo.realizationsFor(fs.map((f) => f.id));
  const limit = q.limit ?? 50;
  const cur = decodeCursor(q.cursor);
  const asOf = "live";
  const offset = cur && cur.a === asOf ? cur.o : 0;
  const evs = new Map((await repo.listEvents(500)).map((e) => [e.id, e] as const));
  return {
    mode: modeInfo(new Date()),
    rows: fs.slice(offset, offset + limit).map((f) => ({ forecast: f, realization: rz.get(f.id) ?? null, eventTitle: evs.get(f.eventId)?.originalTitle ?? f.eventId, eventId: f.eventId, sample: "live", superseded: fs.some((x) => x.supersedes === f.id) })),
    total: fs.length,
    nextCursor: offset + limit < fs.length ? encodeCursor(offset + limit, asOf) : null,
    counts: { live: fs.length },
  };
}

export async function liveStatus(): Promise<StatusView> {
  const now = new Date();
  const repo = getRepository();
  const feed = await liveFeed({ limit: 1 });
  const jobs = await repo.listJobs(10);
  return {
    mode: modeInfo(now),
    providers: liveProviderViews(liveConfig()),
    freshness: feed.freshness,
    pipeline: {
      stages: lastReport?.stages ?? [],
      deadLetters: await repo.listDeadLetters(20),
      quarantined: [],
      skippedDuplicates: 0,
      licenseBlocked: 0,
      ms: lastReport ? Date.parse(lastReport.finishedAt) - Date.parse(lastReport.startedAt) : null,
      ranAt: lastReport?.finishedAt ?? null,
    },
    model: null,
    jobs: jobs.map((j) => ({ id: j.id, kind: j.kind, status: j.status, startedAt: j.startedAt, finishedAt: j.finishedAt, detail: typeof j.detail === "object" && j.detail && "reason" in j.detail ? String((j.detail as { reason: unknown }).reason ?? "") : "" })),
    buildMs: null,
  };
}

export async function liveSearch(q: string): Promise<SearchHit[]> {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const master = await liveMaster();
  const tickers = master.securities
    .filter((s) => s.ticker.toLowerCase() === needle || s.ticker.toLowerCase().startsWith(needle) || s.name.toLowerCase().includes(needle))
    .slice(0, 8)
    .map((s) => ({ kind: "ticker" as const, id: s.id, label: s.ticker, sublabel: s.name, href: `/ticker/${s.ticker}` }));
  const evs = (await getRepository().listEvents(300)).filter((e) => `${e.bottomLine} ${e.originalTitle}`.toLowerCase().includes(needle)).slice(0, 6);
  return [...tickers, ...evs.map((e) => ({ kind: "event" as const, id: e.id, label: e.originalTitle, sublabel: e.subtype, href: `/events/${e.id}` }))];
}
