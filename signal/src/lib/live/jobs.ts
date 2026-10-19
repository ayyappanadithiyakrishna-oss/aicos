/**
 * Live ingestion and forecast-resolution jobs. Bounded, idempotent batches suitable for Vercel Cron
 * (or an external durable scheduler). Provider failures are recorded; they never produce synthetic
 * data. Each run re-processes the providers' recent window so event identity stays stable and
 * unchanged forecasts are reused rather than re-issued.
 */
import type { IntelligenceEvent, Security } from "@/lib/domain/types";
import type { Repository } from "@/lib/db/repo";
import { canonicalUrl, contentHash } from "@/lib/analysis/canonicalize";
import { extractWithLlm, llmConfigFromEnv } from "@/lib/analysis/llm";
import { runPipeline, type PipelineResult } from "@/lib/ingestion/pipeline";
import type { RawRecord } from "@/lib/ingestion/types";
import { resolveForecast } from "@/lib/quant/resolve";
import { horizonWindow } from "@/lib/calendar/horizons";
import { PointInTimeView, trailingBeta, trailingDailyVol } from "@/lib/quant/features";
import { fetchCompanyTickers, fetchCurrentFilings, filingToRecord } from "@/lib/providers/sec";
import { FRED_SERIES, latestRelease, releaseToRecord } from "@/lib/providers/fred";
import { fmpLatestNews, massiveNews } from "@/lib/providers/vendors";
import { RSS_FEEDS, fetchRss, gdeltNews, nasdaqDirectory } from "@/lib/providers/free";
import { buildLiveMaster, LIVE_PROXIES } from "./master";
import { LivePriceStore } from "./prices";
import { anyLiveProvider, liveConfig, liveSources, type LiveConfig } from "./registry";

export interface IngestReport {
  status: "ok" | "partial" | "skipped" | "failed";
  reason: string | null;
  startedAt: string;
  finishedAt: string;
  fetched: Record<string, number>;
  errors: Array<{ provider: string; error: string }>;
  newRecords: number;
  events: number;
  forecastsInserted: number;
  stages: PipelineResult["stages"];
  deadLetters: number;
  ingestLagMinutes: number[];
}

let masterCache: { at: number; companies: Security[] } | null = null;

async function securities(cfg: LiveConfig, errors: IngestReport["errors"]): Promise<Security[]> {
  if (!cfg.secUa) {
    if (!cfg.free) return [];
    if (masterCache && Date.now() - masterCache.at < 24 * 3_600_000) return masterCache.companies;
    try {
      const companies = await nasdaqDirectory();
      masterCache = { at: Date.now(), companies };
      return companies;
    } catch (e) {
      errors.push({ provider: "nasdaqtrader", error: e instanceof Error ? e.message : String(e) });
      return masterCache?.companies ?? [];
    }
  }
  if (masterCache && Date.now() - masterCache.at < 24 * 3_600_000) return masterCache.companies;
  try {
    const companies = await fetchCompanyTickers(cfg.secUa);
    masterCache = { at: Date.now(), companies };
    return companies;
  } catch (e) {
    errors.push({ provider: "sec", error: `symbol directory: ${e instanceof Error ? e.message : String(e)}` });
    return masterCache?.companies ?? [];
  }
}

export async function liveMaster(cfg = liveConfig()) {
  const errs: IngestReport["errors"] = [];
  return buildLiveMaster(await securities(cfg, errs));
}

export async function fetchLiveRecords(cfg: LiveConfig, now: Date): Promise<{ records: RawRecord[]; fetched: Record<string, number>; errors: IngestReport["errors"] }> {
  const fetchedAt = now.toISOString();
  const tasks: Array<[string, Promise<RawRecord[]>]> = [];
  if (cfg.secUa) tasks.push(["sec", fetchCurrentFilings(cfg.secUa, { form: "8-K", count: 100 }).then((fs) => fs.map((f) => filingToRecord(f, fetchedAt)))]);
  if (cfg.fredKey) {
    tasks.push([
      "fred",
      (async () => {
        const out: RawRecord[] = [];
        for (const spec of FRED_SERIES) {
          const r = await latestRelease(cfg.fredKey!, spec);
          if (r && now.getTime() - Date.parse(`${r.releaseDate}T12:00:00Z`) <= 7 * 86_400_000) out.push(releaseToRecord(r, fetchedAt));
        }
        return out;
      })(),
    ]);
  }
  if (cfg.free) {
    for (const f of RSS_FEEDS) tasks.push([f.id, fetchRss(f, fetchedAt)]);
    tasks.push(["gdelt", gdeltNews(fetchedAt)]);
  }
  if (cfg.fmpKey && cfg.fmpDisplay) tasks.push(["fmp", fmpLatestNews(cfg.fmpKey, fetchedAt)]);
  if (cfg.massiveKey && cfg.massiveDisplay) tasks.push(["massive", massiveNews(cfg.massiveKey, fetchedAt)]);
  const settled = await Promise.allSettled(tasks.map(([, p]) => p));
  const records: RawRecord[] = [];
  const horizonMs = 4 * 86_400_000;
  const fetched: Record<string, number> = {};
  const errors: IngestReport["errors"] = [];
  settled.forEach((s, i) => {
    const name = tasks[i]![0];
    if (s.status === "fulfilled") {
      const recent = s.value.filter((r) => !r.publishedAt || now.getTime() - Date.parse(r.publishedAt) <= horizonMs);
      records.push(...recent);
      fetched[name] = recent.length;
    } else {
      fetched[name] = 0;
      errors.push({ provider: name, error: s.reason instanceof Error ? s.reason.message : String(s.reason) });
    }
  });
  // The same story can appear in several feeds: keep one copy per URL.
  const byUrl = new Map<string, RawRecord>();
  for (const r of records) if (!byUrl.has(r.url)) byUrl.set(r.url, r);
  return { records: [...byUrl.values()], fetched, errors };
}

export async function runLiveIngest(opts: { now: Date; repo: Repository; trigger: "cron" | "admin" | "on_demand"; cfg?: LiveConfig }): Promise<IngestReport> {
  const cfg = opts.cfg ?? liveConfig();
  const startedAt = opts.now.toISOString();
  const base: IngestReport = { status: "skipped", reason: null, startedAt, finishedAt: startedAt, fetched: {}, errors: [], newRecords: 0, events: 0, forecastsInserted: 0, stages: [], deadLetters: 0, ingestLagMinutes: [] };
  if (!anyLiveProvider(cfg)) return { ...base, reason: "No live provider is configured and entitled. Live mode shows an empty, labelled state — never synthetic data." };
  const slot = Math.floor(opts.now.getTime() / (5 * 60_000));
  const job = await opts.repo.startJob("ingest", `${opts.trigger}:${slot}`, startedAt);
  if (!job.acquired) return { ...base, reason: "An ingest for this 5-minute slot already ran (idempotent skip)." };
  try {
    const { records, fetched, errors } = await fetchLiveRecords(cfg, opts.now);
    const companies = await securities(cfg, errors);
    const master = buildLiveMaster(companies);
    const prices = new LivePriceStore(cfg);
    // Prefetch prices only for issuers named in this batch plus proxies.
    const named = new Map<string, Security>();
    for (const r of records) {
      const cik = r.structured?.filing?.cik;
      const sec = cik ? master.byCik(cik) : null;
      if (sec) named.set(sec.id, sec);
      for (const t of r.tickers) {
        const s = master.byTicker(t);
        if (s) named.set(s.id, s);
      }
    }
    const priceErr = await prices.prefetch([...LIVE_PROXIES, ...named.values()], opts.now);
    for (const e of priceErr.errors.slice(0, 5)) errors.push({ provider: "prices", error: e });
    const keys = records.map((r) => contentHash([r.sourceId, r.title, r.excerpt]));
    const seen = await opts.repo.seenKeys(keys);
    const existing = await opts.repo.listEvents(300);
    const priorForecasts = await opts.repo.latestForecasts(existing.map((e) => e.id));
    const llmCfg = llmConfigFromEnv();
    const result = await runPipeline(records, {
      mode: "live",
      master,
      sources: new Map(liveSources(cfg).map((s) => [s.id, s] as const)),
      model: null, // No model trained on licensed point-in-time history is deployed; forecasts abstain or give direction only.
      prices,
      now: opts.now,
      providerStale: () => false,
      llm: llmCfg ? (args) => extractWithLlm(llmCfg, args) : null,
      priorForecasts,
      dropIrrelevant: true,
    });
    await opts.repo.recordRaw(
      records.map((r, i) => ({ key: keys[i]!, provider: r.provider, providerId: r.providerId, canonicalUrl: canonicalUrl(r.url), fetchedAt: r.fetchedAt, publishedAt: r.publishedAt, status: seen.has(keys[i]!) ? "seen" : "processed" })),
    );
    await opts.repo.upsertEvents(result.events);
    const ins = await opts.repo.insertForecasts(result.events.flatMap((e) => e.forecasts));
    await opts.repo.upsertRealizations(result.events.flatMap((e) => e.realizations));
    await opts.repo.recordDeadLetters(result.deadLetters);
    const report: IngestReport = {
      status: errors.length ? "partial" : "ok",
      reason: errors.length ? "Some providers failed; their data is absent (not synthesized)." : null,
      startedAt,
      finishedAt: new Date().toISOString(),
      fetched,
      errors,
      newRecords: keys.filter((k) => !seen.has(k)).length,
      events: result.events.length,
      forecastsInserted: ins.inserted,
      stages: result.stages,
      deadLetters: result.deadLetters.length,
      // Lag is measured only on items first seen within 6h of publication (feeds also re-list old stories).
      ingestLagMinutes: records
        .filter((r, i) => r.publishedAt && !seen.has(keys[i]!) && Date.parse(r.fetchedAt) - Date.parse(r.publishedAt) < 6 * 3_600_000)
        .map((r) => Math.max(0, (Date.parse(r.fetchedAt) - Date.parse(r.publishedAt!)) / 60000)),
    };
    await opts.repo.finishJob(job.id, report.status === "ok" ? "ok" : "failed", report, report.finishedAt);
    return report;
  } catch (e) {
    const report = { ...base, status: "failed" as const, reason: e instanceof Error ? e.message : String(e), finishedAt: new Date().toISOString() };
    await opts.repo.finishJob(job.id, "failed", report, report.finishedAt);
    return report;
  }
}

export async function runResolveForecasts(opts: { now: Date; repo: Repository; cfg?: LiveConfig }) {
  const cfg = opts.cfg ?? liveConfig();
  const forecasts = await opts.repo.allForecasts({ limit: 2000 });
  const existing = await opts.repo.realizationsFor(forecasts.map((f) => f.id));
  const due = forecasts.filter((f) => existing.get(f.id)?.status !== "resolved");
  if (!due.length) return { resolved: 0, failed: 0, pending: 0, skipped: "nothing due" };
  const master = await liveMaster(cfg);
  const prices = new LivePriceStore(cfg);
  const secs = [...new Set(due.map((f) => f.securityId))].map((id) => master.byId(id)).filter((s): s is Security => Boolean(s));
  await prices.prefetch([LIVE_PROXIES[0]!, ...secs], opts.now, 60);
  const bench = prices.daily("live:SPY");
  const events = new Map<string, IntelligenceEvent | null>();
  let resolved = 0;
  let failed = 0;
  let pending = 0;
  const rows = [];
  for (const f of due) {
    if (!events.has(f.eventId)) events.set(f.eventId, await opts.repo.getEvent(f.eventId));
    const ev = events.get(f.eventId);
    const bars = f.horizon === "1h" ? null : prices.daily(f.securityId);
    if (!ev || !bars) {
      pending++;
      continue;
    }
    const view = new PointInTimeView(ev.firstPublishedAt);
    const sigmaD = trailingDailyVol(view, bars);
    const beta = bench ? trailingBeta(view, bars, bench) : null;
    const w = horizonWindow(new Date(ev.firstPublishedAt), f.horizon);
    const r = resolveForecast({ forecast: f, publishedAt: ev.firstPublishedAt, assetBars: bars, benchmarkBars: bench, beta, sigmaHPct: sigmaD ? sigmaD * 100 * Math.sqrt(w.tradingDays) : null, now: opts.now, overlapping: ev.overlapping });
    if (r.status === "resolved") resolved++;
    else if (r.status === "pending") pending++;
    else failed++;
    rows.push(r);
  }
  await opts.repo.upsertRealizations(rows);
  return { resolved, failed, pending, skipped: null };
}
