/**
 * DEMO world assembly. Builds a deterministic synthetic market, trains the event-reaction model on
 * measured history, runs walk-forward out-of-sample evaluation, then runs the REAL ingestion
 * pipeline over synthetic articles. Everything produced here is labelled synthetic.
 */
import type { Analog, ForecastRealization, ForecastSnapshot, Horizon, IntelligenceEvent, Source } from "@/lib/domain/types";
import { horizonWindow } from "@/lib/calendar/horizons";
import { dateKeyOf } from "@/lib/calendar/time";
import { SecurityMaster } from "@/lib/analysis/securityMaster";
import { runPipeline, forecastKey, type PipelineResult } from "@/lib/ingestion/pipeline";
import type { PriceStore } from "@/lib/ingestion/priceStore";
import type { ClassKey } from "@/lib/quant/calibration";
import { buildScorecard, type ScoredRow, type Scorecard } from "@/lib/quant/evaluate";
import { buildForecast } from "@/lib/quant/forecast";
import { forecastPath } from "@/lib/analysis/mechanisms";
import { classOf, trainModel, type EventReactionModel, type TrainingExample } from "@/lib/quant/model";
import { indexAtOrBefore, lastBarAtOrBefore, logReturnPct } from "@/lib/quant/returns";
import { hashHex, mean, olsSlope, std } from "@/lib/quant/stats";
import { DEMO_ANCHOR, demoArticles, demoCatalysts, type DemoCatalyst } from "./articles";
import { generateMarket, trueEffectY, type MarketData, type SyntheticEvent } from "./market";
import { DEMO_ALIASES, DEMO_MEMBERSHIPS, DEMO_RELATIONSHIPS, DEMO_SECURITIES, DEMO_SOURCES } from "./universe";

export const DEMO_MODEL_VERSION = "erm-2026.07-syn";
export const DEMO_TRAINING_CUTOFF = "2026-01-02T00:00:00.000Z";
export const DEMO_CALIBRATION_END = "2026-07-01T00:00:00.000Z";
const FOLDS = ["2025-04-01", "2025-07-01", "2025-10-01", "2026-01-02", "2026-04-01", "2026-07-01"];

export interface ArchiveEntry {
  forecast: ForecastSnapshot;
  realization: ForecastRealization | null;
  eventTitle: string;
  eventId: string;
  sector: string;
  subtype: string;
  sample: "oos" | "in_sample" | "live_demo";
  superseded: boolean;
}

export interface DemoWorld {
  anchor: Date;
  master: SecurityMaster;
  sources: Map<string, Source>;
  market: MarketData;
  prices: PriceStore;
  model: EventReactionModel;
  events: IntelligenceEvent[];
  pipeline: Omit<PipelineResult, "events"> & { ms: number };
  scorecardRows: ScoredRow[];
  climatology: Record<ClassKey, number>;
  archive: ArchiveEntry[];
  catalysts: DemoCatalyst[];
  history: SyntheticEvent[];
  trainingN: Record<string, number>;
  buildMs: number;
}

interface Measured extends TrainingExample {
  rawPct: number;
  benchPct: number;
  beta: number;
  sigmaD: number;
  baseline: { price: number; at: string };
  windowEnd: string;
  subtypeKey: string;
  title: string;
  ticker: string;
}

function makePriceStore(m: MarketData): PriceStore {
  return {
    entitlement: "synthetic",
    delayMinutes: 0,
    source: "Synthetic price paths (demo DGP)",
    daily: (id) => m.daily.get(id) ?? null,
    intraday: (id) => m.intraday.get(id) ?? null,
    splits: () => [],
  };
}

const idxAtOrBefore = indexAtOrBefore;

function measureHistory(world: { market: MarketData; master: SecurityMaster }, events: SyntheticEvent[], anchor: Date): Measured[] {
  const bench = world.master.benchmark()!;
  const benchDaily = world.market.daily.get(bench.id)!;
  const benchIntra = world.market.intraday.get(bench.id)!;
  const retCache = new Map<string, number[]>();
  const rets = (id: string) => {
    let r = retCache.get(id);
    if (!r) {
      const b = world.market.daily.get(id)!;
      r = b.map((x, i) => (i === 0 ? 0 : logReturnPct(b[i - 1]!.c, x.c)));
      retCache.set(id, r);
    }
    return r;
  };
  // Overlap: another event touching the same security within ±1 trading day.
  const touches = new Map<string, number[]>();
  for (const e of events) for (const x of e.exposures) touches.set(x.securityId, [...(touches.get(x.securityId) ?? []), Date.parse(e.at)]);
  const out: Measured[] = [];
  for (const ev of events) {
    const at = Date.parse(ev.at);
    const windows = new Map<Horizon, ReturnType<typeof horizonWindow>>();
    const windowFor = (h: Horizon) => {
      let w = windows.get(h);
      if (!w) windows.set(h, (w = horizonWindow(new Date(ev.at), h)));
      return w;
    };
    for (const ex of ev.exposures) {
      const daily = world.market.daily.get(ex.securityId);
      if (!daily?.length) continue;
      const idx = idxAtOrBefore(daily, at);
      if (idx < 125) continue;
      const r = rets(ex.securityId);
      const rb = rets(bench.id);
      const win = r.slice(idx - 59, idx + 1);
      const sigmaD = std(win) / 100;
      const beta = ex.securityId === bench.id ? 1 : olsSlope(rb.slice(idx - 119, idx + 1), r.slice(idx - 119, idx + 1)) ?? 1;
      const overlapping = (touches.get(ex.securityId) ?? []).some((t) => t !== at && Math.abs(t - at) < 30 * 3_600_000);
      for (const h of ["1h", "next_session", "5_sessions"] as Horizon[]) {
        const w = windowFor(h);
        if (w.end.getTime() > anchor.getTime()) continue;
        const bars = h === "1h" ? world.market.intraday.get(ex.securityId)! : daily;
        const bb = h === "1h" ? benchIntra : benchDaily;
        const p0 = lastBarAtOrBefore(bars, w.start);
        const p1 = lastBarAtOrBefore(bars, w.end);
        const b0 = lastBarAtOrBefore(bb, w.start);
        const b1 = lastBarAtOrBefore(bb, w.end);
        if (!p0 || !p1 || !b0 || !b1 || p0.t === p1.t || b0.t === b1.t) continue;
        const maxGap = h === "1h" ? 61 * 60000 : 4 * 86_400_000;
        if (w.start.getTime() - Date.parse(p0.t) > maxGap || w.end.getTime() - Date.parse(p1.t) > maxGap) continue;
        const raw = logReturnPct(p0.c, p1.c);
        const benchPct = logReturnPct(b0.c, b1.c);
        const ar = raw - beta * benchPct;
        const sigmaHPct = sigmaD * 100 * Math.sqrt(w.tradingDays);
        const sec = world.master.byId(ex.securityId)!;
        out.push({
          eventId: ev.id,
          securityId: ex.securityId,
          ticker: sec.ticker,
          at: ev.at,
          horizon: h,
          path: forecastPath(ev.subtype, ev.bucket, ex.channelKey),
          sigmaHPct,
          arPct: ar,
          overlapping,
          sector: sec.sector,
          eventKind: ev.subtype,
          regime: ev.regime,
          rawPct: raw,
          benchPct,
          beta,
          sigmaD,
          baseline: { price: p0.c, at: p0.t },
          windowEnd: w.end.toISOString(),
          subtypeKey: ev.subtype,
          title: ev.title,
        });
      }
    }
  }
  return out;
}

/** Purge examples whose outcome window extends past a split boundary (no leakage across splits). */
function purged<T extends { at: string; windowEnd: string }>(xs: T[], cutoff: string): T[] {
  const c = Date.parse(cutoff);
  return xs.filter((x) => Date.parse(x.at) >= c || Date.parse(x.windowEnd) < c);
}

function scoreRows(model: EventReactionModel, xs: Measured[], sample: ScoredRow["sample"], train: Measured[], marketDrift: (at: string) => number): { rows: ScoredRow[]; archive: ArchiveEntry[] } {
  const prior = new Map<string, number>();
  const bySub = new Map<string, number[]>();
  for (const t of train) if (t.horizon === "next_session") bySub.set(t.subtypeKey, [...(bySub.get(t.subtypeKey) ?? []), t.arPct]);
  for (const [k, v] of bySub) prior.set(k, mean(v));
  const rows: ScoredRow[] = [];
  const archive: ArchiveEntry[] = [];
  for (const x of xs) {
    const generatedAt = new Date(Date.parse(x.at) + 2 * 60000).toISOString();
    const f = buildForecast(
      {
        eventId: x.eventId,
        securityId: x.securityId,
        ticker: x.ticker,
        horizon: x.horizon,
        forecastGeneratedAt: generatedAt,
        asOf: generatedAt,
        path: x.path,
        sigmaHPct: x.sigmaHPct,
        baseline: Date.parse(x.baseline.at) <= Date.parse(generatedAt) ? x.baseline : null,
        mechanismSign: x.path[2]!.endsWith(":positive") ? "positive" : x.path[2]!.endsWith(":negative") ? "negative" : "mixed",
        exposureVerified: true,
        numericFactsVerified: true,
        sourceConflict: false,
        providerStale: false,
        overlapping: x.overlapping,
        provenance: ["synthetic"],
        invalidationConditions: [],
        isSynthetic: true,
      },
      model,
    );
    const outcome = classOf(x.arPct / x.sigmaHPct);
    const realization: ForecastRealization = {
      id: `rz_${hashHex(`${f.id}|realization`)}`,
      forecastId: f.id,
      status: "resolved",
      windowStart: x.baseline.at,
      windowEnd: x.windowEnd,
      rawReturnPct: x.rawPct,
      benchmarkReturnPct: x.benchPct,
      abnormalReturnPct: x.arPct,
      betaUsed: x.beta,
      outcomeClass: outcome,
      resolvedAt: x.windowEnd,
      quality: x.overlapping ? "overlapping_event" : "clean",
      failureReason: null,
    };
    archive.push({ forecast: f, realization, eventTitle: x.title, eventId: x.eventId, sector: x.sector, subtype: x.subtypeKey, sample, superseded: false });
    if (f.qualityTier === "insufficient") continue;
    const tdays = x.horizon === "1h" ? 1 / 6.5 : x.horizon === "next_session" ? 1 : 5;
    rows.push({
      forecastId: f.id,
      at: x.at,
      horizon: x.horizon,
      sample,
      sector: x.sector,
      eventKind: x.subtypeKey.split(".")[0]!,
      regime: x.regime,
      direction: f.direction,
      central: f.centralMovePct,
      lo: f.intervalLowPct,
      hi: f.intervalHighPct,
      probabilities: f.probabilities,
      realizedAr: x.arPct,
      outcome,
      baselines: { zero: 0, eventPrior: prior.get(x.subtypeKey) ?? 0, marketBeta: x.beta * marketDrift(x.at) * tdays },
      realizedRaw: x.rawPct,
    });
  }
  return { rows, archive };
}

const DEBUG = typeof process !== "undefined" && process.env.SIGNAL_DEBUG_WORLD === "1";
let lastMark = 0;
function mark(label: string): void {
  if (!DEBUG) return;
  const now = performance.now();
  console.log(`[world] ${label}: ${Math.round(now - lastMark)}ms`);
  lastMark = now;
}

async function build(): Promise<DemoWorld> {
  const t0 = performance.now();
  lastMark = t0;
  const anchor = DEMO_ANCHOR;
  const master = new SecurityMaster(DEMO_SECURITIES, DEMO_RELATIONSHIPS, DEMO_MEMBERSHIPS, DEMO_ALIASES);
  const sources = new Map(DEMO_SOURCES.map((s) => [s.id, s] as const));
  const records = demoArticles();
  const stale = (p: string) => p === "demo-wire-b";

  // Pass 1: analysis without prices to learn each current event's exposures (for jump injection).
  const pass1 = await runPipeline(records, {
    mode: "demo",
    master,
    sources,
    model: null,
    prices: { entitlement: "none", delayMinutes: null, source: "none", daily: () => null, intraday: () => null, splits: () => [] },
    now: anchor,
    providerStale: stale,
  });
  const currentEvents: SyntheticEvent[] = pass1.events.map((e) => {
    const z = e.macro?.surpriseZ ?? e.earnings?.surpriseZ ?? null;
    const shockFromMacro = e.macro?.surprise ? (Math.sign(e.macro.surprise) as 1 | -1) : 0;
    return {
      id: e.id,
      at: e.firstPublishedAt,
      subtype: e.subtype,
      bucket: "na",
      shock: shockFromMacro,
      magnitudeZ: z,
      issuerId: null,
      title: e.originalTitle,
      regime: "normal",
      isCurrent: true,
      exposures: e.exposures.map((x) => {
        const sec = master.byId(x.securityId)!;
        const fl = sec.factorLoadings ?? {};
        const L = x.relationship === "rate_sensitivity" ? Math.abs(fl.ratesPer100bp ?? 0) : x.relationship === "commodity_sensitivity" ? Math.abs(fl.oilPer10pct ?? 0) : x.relationship === "fx_sensitivity" ? Math.abs(fl.usdPer5pct ?? 0) : 1;
        const s = x.sign === "positive" ? 1 : x.sign === "negative" ? -1 : 0;
        const shock = (e.macro ? shockFromMacro : s) as 1 | -1 | 0;
        return { securityId: x.securityId, channelKey: `${x.relationship}:${x.sign}`, sign: x.sign, relationship: x.relationship, yTrue: trueEffectY(e.subtype, `${x.relationship}:${x.sign}`, z, shock, L) };
      }),
    };
  });

  mark("pass1");
  // Market with history + current-event jumps.
  const market = generateMarket({ master, endKey: dateKeyOf(anchor), endInstant: anchor, currentEvents });
  mark("generateMarket");
  const prices = makePriceStore(market);
  const measured = measureHistory({ market, master }, market.history, anchor);
  mark("measureHistory");
  const bench = master.benchmark()!;
  const benchDaily = market.daily.get(bench.id)!;
  const marketDrift = (at: string) => {
    const i = idxAtOrBefore(benchDaily, Date.parse(at));
    if (i < 61) return 0;
    const r: number[] = [];
    for (let k = i - 59; k <= i; k++) r.push(logReturnPct(benchDaily[k - 1]!.c, benchDaily[k]!.c));
    return mean(r);
  };

  // Current production model.
  const examples = purged(purged(measured, DEMO_TRAINING_CUTOFF), DEMO_CALIBRATION_END);
  const model = trainModel(examples, {
    version: DEMO_MODEL_VERSION,
    trainedAt: "2026-07-02T06:00:00.000Z",
    trainingCutoff: DEMO_TRAINING_CUTOFF,
    calibrationEnd: DEMO_CALIBRATION_END,
    isSynthetic: true,
    horizons: ["1h", "next_session", "5_sessions"],
  });

  mark("trainModel");
  // Walk-forward out-of-sample evaluation.
  const scorecardRows: ScoredRow[] = [];
  const archive: ArchiveEntry[] = [];
  for (let i = 0; i < FOLDS.length; i++) {
    const F = `${FOLDS[i]}T00:00:00.000Z`;
    const next = i + 1 < FOLDS.length ? `${FOLDS[i + 1]}T00:00:00.000Z` : anchor.toISOString();
    const calStart = new Date(Date.parse(F) - 182 * 86_400_000).toISOString();
    const ex = purged(purged(measured, calStart), F);
    const m = trainModel(ex, { version: `erm-wf-${FOLDS[i]}`, trainedAt: F, trainingCutoff: calStart, calibrationEnd: F, isSynthetic: true, horizons: ["1h", "next_session", "5_sessions"] });
    const test = measured.filter((x) => x.at >= F && x.at < next && Date.parse(x.windowEnd) <= anchor.getTime());
    const train = measured.filter((x) => Date.parse(x.windowEnd) < Date.parse(calStart));
    const s = scoreRows(m, test, "oos", train, marketDrift);
    scorecardRows.push(...s.rows);
    archive.push(...s.archive);
  }
  mark("walkForward");
  // In-sample contrast: the production model scored on its own training data.
  const trainSet = measured.filter((x) => Date.parse(x.windowEnd) < Date.parse(DEMO_TRAINING_CUTOFF));
  const ins = scoreRows(model, trainSet, "in_sample", trainSet, marketDrift);
  scorecardRows.push(...ins.rows);

  const clim = { up: 0, down: 0, neutral: 0 } as Record<ClassKey, number>;
  const ns = examples.filter((x) => x.horizon === "next_session" && Date.parse(x.at) < Date.parse(DEMO_TRAINING_CUTOFF));
  for (const x of ns) clim[classOf(x.arPct / x.sigmaHPct)] += 1;
  const tot = ns.length || 1;
  const climatology = { up: clim.up / tot, down: clim.down / tot, neutral: clim.neutral / tot };

  // Analogs from measured history (strict match on subtype + bucket).
  const firstExposureAr = new Map<string, number>();
  for (const x of measured) if (x.horizon === "next_session" && !firstExposureAr.has(x.eventId)) firstExposureAr.set(x.eventId, x.arPct);
  const analogs = (subtype: string, bucket: string): { analogs: Analog[]; note: string } => {
    const pool = market.history.filter((h) => h.subtype === subtype && (bucket === "na" || h.bucket === bucket));
    const n = pool.length;
    if (n < 3) return { analogs: [], note: `Insufficient analogs: ${n} strictly comparable synthetic events (subtype + bucket).` };
    const chosen = [...pool].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
    return {
      analogs: chosen.map((h) => ({ eventId: h.id, title: h.title, at: h.at, abnormalReturnPct: firstExposureAr.get(h.id) ?? null, similarity: h.bucket === bucket ? 1 : 0.6 })),
      note: `${n} strictly comparable synthetic events (match: ${subtype}${bucket !== "na" ? ` · ${bucket}` : ""}); showing the 5 most recent, not cherry-picked.`,
    };
  };

  mark("inSample+analogs");
  // Pass 2a: the first QNTM report alone at 14:20 (before the conflicting report arrives).
  const early = await runPipeline(
    records.filter((r) => r.providerId === "qntm-prelim-a"),
    { mode: "demo", master, sources, model, prices, now: new Date(Date.parse(records.find((r) => r.providerId === "qntm-prelim-a")!.fetchedAt) + 2 * 60000), providerStale: stale },
  );
  const priorForecasts = new Map<string, ForecastSnapshot>();
  for (const e of early.events) for (const f of e.forecasts) priorForecasts.set(forecastKey(f), f);

  // Pass 2: full pipeline with prices, trained model and prior forecasts (revision chain).
  const tp = performance.now();
  const result = await runPipeline(records, {
    mode: "demo",
    master,
    sources,
    model,
    prices,
    now: anchor,
    providerStale: stale,
    analogs: (st, b) => analogs(st, b),
    priorForecasts,
  });
  const pipelineMs = performance.now() - tp;
  mark("pass2");

  for (const e of result.events) {
    for (const f of e.forecasts) {
      archive.push({ forecast: f, realization: e.realizations.find((r) => r.forecastId === f.id) ?? null, eventTitle: e.originalTitle, eventId: e.id, sector: e.sectors[0] ?? "—", subtype: e.subtype, sample: "live_demo", superseded: false });
    }
  }
  for (const f of result.superseded) {
    const e = result.events.find((x) => x.id === f.eventId);
    archive.push({ forecast: f, realization: null, eventTitle: e?.originalTitle ?? f.eventId, eventId: f.eventId, sector: e?.sectors[0] ?? "—", subtype: e?.subtype ?? "", sample: "live_demo", superseded: true });
  }

  const trainingN: Record<string, number> = {};
  for (const [h, hm] of Object.entries(model.horizons)) trainingN[h] = hm!.trainN;
  const { events, ...rest } = result;
  return {
    anchor,
    master,
    sources,
    market,
    prices,
    model,
    events,
    pipeline: { ...rest, ms: Math.round(pipelineMs) },
    scorecardRows,
    climatology,
    archive,
    catalysts: demoCatalysts(),
    history: market.history,
    trainingN,
    buildMs: Math.round(performance.now() - t0),
  };
}

let worldPromise: Promise<DemoWorld> | null = null;

/** Memoized per server instance; deterministic, so every instance builds the identical world. */
export function getDemoWorld(): Promise<DemoWorld> {
  if (!worldPromise) worldPromise = build();
  return worldPromise;
}

export function demoScorecard(world: DemoWorld, opts: { from?: string; to?: string; minSample?: number } = {}): Scorecard {
  return buildScorecard(world.scorecardRows, { climatology: world.climatology, generatedAt: world.anchor.toISOString(), ...opts });
}
