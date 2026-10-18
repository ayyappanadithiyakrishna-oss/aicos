/**
 * DEMO data service: every view is derived from the deterministic synthetic world. Nothing here
 * calls a network provider, and every object is flagged synthetic.
 */
import type { IntelligenceEvent, PriceBar, Quote } from "@/lib/domain/types";
import { marketClock, sessionOn } from "@/lib/calendar/nyse";
import { dateKeyOf } from "@/lib/calendar/time";
import { computeMacroSurprise } from "@/lib/analysis/macro";
import { structuredSourceText } from "@/lib/analysis/explain";
import { detectInjection } from "@/lib/security/sanitize";
import { indexAtOrBefore, logReturnPct } from "@/lib/quant/returns";
import { quantile } from "@/lib/quant/stats";
import { demoArticles, et } from "@/lib/demo/articles";
import { SECTOR_ETF } from "@/lib/demo/universe";
import { demoScorecard, getDemoWorld, type DemoWorld } from "@/lib/demo/world";
import { decodeCursor, encodeCursor, queryFeed } from "./feedQuery";
import type {
  ArchiveQuery,
  ArchiveView,
  CalendarItem,
  EarningsRow,
  FeedQuery,
  FeedResult,
  FilingRow,
  ImpactHistoryRow,
  MacroRow,
  MarketPulseView,
  ModeInfo,
  PulseRibbonItem,
  ScorecardView,
  SearchHit,
  SourceDocument,
  StatusView,
  TickerView,
} from "./views";

export const DEMO_REASON = "No live provider credentials are configured (or DEMO_MODE is not false). All data is synthetic.";

function modeInfo(w: DemoWorld): ModeInfo {
  return {
    mode: "demo",
    asOf: w.anchor.toISOString(),
    clock: marketClock(w.anchor),
    label: "DEMO · SYNTHETIC DATA",
    priceEntitlement: "synthetic",
    priceSource: w.prices.source,
    demoReason: DEMO_REASON,
  };
}

function prevClose(daily: readonly PriceBar[], at: Date): PriceBar | null {
  const today = dateKeyOf(at);
  for (let i = daily.length - 1; i >= 0; i--) if (dateKeyOf(new Date(daily[i]!.t)) < today) return daily[i]!;
  return null;
}

export function demoQuote(w: DemoWorld, securityId: string): Quote {
  const sec = w.master.byId(securityId)!;
  const intraday = w.prices.intraday(securityId) ?? [];
  const daily = w.prices.daily(securityId) ?? [];
  const lastI = intraday[indexAtOrBefore(intraday, w.anchor.getTime())] ?? null;
  const lastD = daily[indexAtOrBefore(daily, w.anchor.getTime())] ?? null;
  const last = lastI && lastD && Date.parse(lastI.t) > Date.parse(lastD.t) ? lastI : lastD;
  const pc = prevClose(daily, w.anchor);
  return {
    securityId,
    ticker: sec.ticker,
    last: last?.c ?? null,
    changePct: last && pc ? Math.round(logReturnPct(pc.c, last.c) * 100) / 100 : null,
    asOf: last?.t ?? null,
    entitlement: "synthetic",
    delayMinutes: 0,
    source: "Synthetic price path",
  };
}

export async function demoFeed(q: FeedQuery): Promise<FeedResult> {
  const w = await getDemoWorld();
  const res = queryFeed(w.events, q, w.anchor);
  const lags = demoArticles().map((r) => (Date.parse(r.fetchedAt) - Date.parse(r.publishedAt ?? r.fetchedAt)) / 60000);
  return {
    mode: modeInfo(w),
    ...res,
    freshness: {
      lastIngestAt: w.anchor.toISOString(),
      newestItemAt: w.events.reduce<string | null>((m, e) => (!m || e.firstPublishedAt > m ? e.firstPublishedAt : m), null),
      ingestLagP50Min: quantile(lags, 0.5),
      ingestLagP95Min: quantile(lags, 0.95),
      stale: false,
      note: "Demo world frozen at the demo clock; ingest lags are measured on synthetic timestamps.",
    },
  };
}

export async function demoEvent(id: string): Promise<{ mode: ModeInfo; event: IntelligenceEvent; related: IntelligenceEvent[] } | null> {
  const w = await getDemoWorld();
  const event = w.events.find((e) => e.id === id || e.slug === id);
  if (!event) return null;
  const tickers = new Set(event.exposures.map((x) => x.ticker));
  const related = w.events.filter((e) => e.id !== event.id && (event.overlapsWith.includes(e.id) || e.exposures.some((x) => tickers.has(x.ticker)))).slice(0, 6);
  return { mode: modeInfo(w), event, related };
}

export async function demoRibbon(): Promise<{ mode: ModeInfo; items: PulseRibbonItem[] }> {
  const w = await getDemoWorld();
  const pick = ["MKTX", "GRWX", "SMLX", "DURX", "USDX", "VOLX"];
  return {
    mode: modeInfo(w),
    items: pick.map((t) => {
      const s = w.master.byTicker(t)!;
      const q = demoQuote(w, s.id);
      return { ticker: t, label: s.name.replace("Synthetic ", "").replace(" Fund", "").replace(" Index", ""), last: q.last, changePct: q.changePct, asOf: q.asOf, entitlement: "synthetic", note: "Synthetic proxy" };
    }),
  };
}

function archiveHistoryRows(w: DemoWorld, securityId: string): ImpactHistoryRow[] {
  return w.archive
    .filter((a) => a.forecast.securityId === securityId && a.forecast.horizon === "next_session" && !a.superseded)
    .sort((a, b) => b.forecast.forecastGeneratedAt.localeCompare(a.forecast.forecastGeneratedAt))
    .slice(0, 40)
    .map((a) => {
      const r = a.realization;
      const ar = r?.status === "resolved" ? r.abnormalReturnPct : null;
      const f = a.forecast;
      return {
        forecastId: f.id,
        eventId: a.eventId,
        eventTitle: a.eventTitle,
        generatedAt: f.forecastGeneratedAt,
        horizon: f.horizon,
        central: f.centralMovePct,
        lo: f.intervalLowPct,
        hi: f.intervalHighPct,
        direction: f.direction,
        qualityTier: f.qualityTier,
        realizedAr: ar,
        status: r?.status ?? "pending",
        hit: ar === null || f.centralMovePct === null ? null : Math.sign(ar) === Math.sign(f.centralMovePct),
        inside: ar === null || f.intervalLowPct === null ? null : ar >= f.intervalLowPct && ar <= f.intervalHighPct!,
        sample: a.sample === "live_demo" ? "current" : a.sample,
      };
    });
}

export async function demoTicker(symbol: string): Promise<TickerView | null> {
  const w = await getDemoWorld();
  const sec = w.master.byTicker(symbol.toUpperCase());
  if (!sec) return null;
  const daily = (w.prices.daily(sec.id) ?? []).slice(-260);
  const intraday = (w.prices.intraday(sec.id) ?? []).slice(-13 * 10);
  const events = w.events.filter((e) => e.exposures.some((x) => x.securityId === sec.id)).sort((a, b) => b.firstPublishedAt.localeCompare(a.firstPublishedAt));
  const relationships = [
    ...w.master.relationsOf(sec.id).map((r) => ({ ticker: w.master.byId(r.toId)!.ticker, name: w.master.byId(r.toId)!.name, kind: r.kind, direction: "counterparty" as const, evidence: r.evidence, asOf: r.asOf })),
    ...w.master.relationships.filter((r) => r.toId === sec.id).map((r) => ({ ticker: w.master.byId(r.fromId)!.ticker, name: w.master.byId(r.fromId)!.name, kind: r.kind, direction: "reverse" as const, evidence: r.evidence, asOf: r.asOf })),
  ];
  const memberships = w.master.etfsContaining(sec.id).map((m) => ({ etf: w.master.byId(m.etfId)!.ticker, weight: m.weight, asOf: m.asOf, source: m.source }));
  const holdings = w.master.memberships.filter((m) => m.etfId === sec.id).map((m) => ({ ticker: w.master.byId(m.memberId)!.ticker, weight: m.weight })).sort((a, b) => b.weight - a.weight);
  const cal = (await demoCalendar()).filter((c) => c.tickers.includes(sec.ticker));
  // Attention: events touching the ticker in the last 5 sessions vs the trailing 60-session rate.
  const anchorMs = w.anchor.getTime();
  const all = [...w.history.map((h) => ({ at: h.at, ids: h.exposures.map((x) => x.securityId) })), ...w.events.map((e) => ({ at: e.firstPublishedAt, ids: e.exposures.map((x) => x.securityId) }))].filter((x) => x.ids.includes(sec.id));
  const recent = all.filter((x) => anchorMs - Date.parse(x.at) <= 7 * 86_400_000).length;
  const base = all.filter((x) => anchorMs - Date.parse(x.at) > 7 * 86_400_000 && anchorMs - Date.parse(x.at) <= 91 * 86_400_000).length / 12;
  const trajectory = w.archive
    .filter((a) => a.forecast.securityId === sec.id && a.forecast.horizon === "next_session" && a.sample !== "in_sample")
    .sort((a, b) => a.forecast.forecastGeneratedAt.localeCompare(b.forecast.forecastGeneratedAt))
    .slice(-24)
    .map((a) => ({ at: a.forecast.forecastGeneratedAt, eventId: a.eventId, direction: a.forecast.direction, central: a.forecast.centralMovePct, tier: a.forecast.qualityTier }));
  const peers = [...new Set([...relationships.filter((r) => r.kind === "competitor").map((r) => r.ticker), ...w.master.securities.filter((s) => s.sector === sec.sector && s.id !== sec.id && s.kind === sec.kind).map((s) => s.ticker)])].slice(0, 6);
  return {
    mode: modeInfo(w),
    security: sec,
    quote: demoQuote(w, sec.id),
    daily,
    intraday,
    markers: events.map((e) => ({ at: e.firstPublishedAt, eventId: e.id, label: e.subtype.split(".")[1]!.replace(/_/g, " "), severity: e.severity })),
    events,
    impactHistory: archiveHistoryRows(w, sec.id),
    relationships,
    memberships,
    holdings,
    catalysts: cal,
    attention: {
      recent,
      baseline: base,
      ratio: base > 0 ? Math.round((recent / base) * 10) / 10 : null,
      note: "Events touching this asset in the last 7 days vs. the trailing 12-week weekly average (synthetic history).",
    },
    trajectory,
    options: { available: false, reason: "No entitled options chain in demo mode; implied-move module unavailable. Model estimates are never relabelled as options-implied." },
    peers,
  };
}

export async function demoPulse(): Promise<MarketPulseView> {
  const w = await getDemoWorld();
  const bench = w.master.benchmark()!;
  const bq = demoQuote(w, bench.id);
  const intraday = (w.prices.intraday(bench.id) ?? []).filter((b) => dateKeyOf(new Date(b.t)) === dateKeyOf(w.anchor));
  const equities = w.master.securities.filter((s) => s.kind === "equity");
  let adv = 0;
  let dec = 0;
  let unch = 0;
  for (const s of equities) {
    const c = demoQuote(w, s.id).changePct;
    if (c === null) continue;
    if (c > 0.05) adv++;
    else if (c < -0.05) dec++;
    else unch++;
  }
  const sectors = Object.entries(SECTOR_ETF).map(([sector, t]) => ({ ticker: t, sector, changePct: demoQuote(w, w.master.byTicker(t)!.id).changePct })).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  const cross = [
    { t: "DURX", label: "Long-duration Treasuries (proxy)", note: "Price falls when long yields rise" },
    { t: "USDX", label: "US dollar (proxy)", note: "Dollar basket proxy" },
    { t: "GRWX", label: "Growth equities (proxy)", note: "Long-duration equity proxy" },
    { t: "VOLX", label: "Volatility index (proxy)", note: "Synthetic volatility gauge — not options-implied in demo" },
  ].map((x) => ({ ticker: x.t, label: x.label, changePct: demoQuote(w, w.master.byTicker(x.t)!.id).changePct, note: x.note }));
  const vol = demoQuote(w, w.master.byTicker("VOLX")!.id).last;
  const regime = w.market.regimeByDate.get(dateKeyOf(w.anchor)) ?? "normal";
  const today = dateKeyOf(w.anchor);
  const drivers = w.events
    .filter((e) => dateKeyOf(new Date(e.firstPublishedAt)) === today && e.severity !== "low")
    .sort((a, b) => a.firstPublishedAt.localeCompare(b.firstPublishedAt))
    .map((e) => ({
      eventId: e.id,
      at: e.firstPublishedAt,
      title: e.originalTitle,
      bottomLine: e.bottomLine,
      hypothesis: e.transmission.join(" → "),
      observed: e.pricedIn.map((p) => ({ ticker: p.ticker, changePct: p.realizedSincePct, label: "since publication (observed co-movement, not causal attribution)" })),
    }));
  const s0 = sessionOn(today);
  const elapsed = s0 ? Math.min(1, (w.anchor.getTime() - s0.open.getTime()) / (s0.close.getTime() - s0.open.getTime())) : 1;
  const volumeAnomalies = w.master.securities
    .map((s) => {
      const d = w.prices.daily(s.id) ?? [];
      const avg = d.slice(-20).reduce((a, b) => a + b.v, 0) / Math.max(1, Math.min(20, d.length));
      const todayVol = (w.prices.intraday(s.id) ?? []).filter((b) => dateKeyOf(new Date(b.t)) === today).reduce((a, b) => a + b.v, 0);
      return { ticker: s.ticker, ratio: avg > 0 && elapsed > 0 ? Math.round((todayVol / (avg * elapsed)) * 10) / 10 : 0, note: "Session-to-date volume vs. 20-day average, time-adjusted" };
    })
    .filter((x) => x.ratio >= 1.6)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 6);
  return {
    mode: modeInfo(w),
    benchmark: { ticker: bench.ticker, name: bench.name, changePct: bq.changePct, intraday, prevClose: prevClose(w.prices.daily(bench.id) ?? [], w.anchor)?.c ?? null, last: bq.last },
    breadth: { advancers: adv, decliners: dec, unchanged: unch, universe: equities.length, note: `Synthetic universe of ${equities.length} equities` },
    sectors,
    crossAsset: cross,
    regime: { label: regime === "stressed" ? "Stressed" : regime === "calm" ? "Calm" : "Normal", volIndex: vol, volTicker: "VOLX", note: "Regime from the synthetic volatility process." },
    drivers,
    volumeAnomalies,
    attributionNote:
      "Observed changes are shown as measured. Event-to-price links are hypotheses with observed co-movement, not verified causal attribution; no additive contribution waterfall is shown because no attribution model is fitted.",
  };
}

const MACRO_EXTRA: Array<Omit<MacroRow, "surprise" | "id" | "isSynthetic" | "source" | "eventId"> & { hist: number[] }> = [
  { indicator: "ISM Manufacturing PMI", period: "Sep 2026", releaseAt: et("2026-10-01", 10, 0), releaseTimeKnown: true, status: "released", unit: "index", actual: 49.6, consensus: 48.9, consensusSource: "Demo consensus panel (synthetic)", prior: 48.7, revisedPrior: 48.7, hist: [0.6, -0.4, 1.1, -0.9, 0.3, 0.8, -1.2, 0.2] },
  { indicator: "GDP (QoQ SAAR)", period: "Q2 2026 (third)", releaseAt: et("2026-09-24", 8, 30), releaseTimeKnown: true, status: "released", unit: "%", actual: 2.3, consensus: 2.1, consensusSource: "Demo consensus panel (synthetic)", prior: 2.1, revisedPrior: 2.2, hist: [0.2, -0.3, 0.1, 0.4, -0.2, 0.0, 0.3, -0.1, 0.2, -0.4, 0.1, 0.3, -0.2] },
  { indicator: "Core PCE", period: "Aug 2026", releaseAt: et("2026-09-25", 8, 30), releaseTimeKnown: true, status: "released", unit: "%", actual: 2.9, consensus: 2.9, consensusSource: "Demo consensus panel (synthetic)", prior: 2.8, revisedPrior: 2.8, hist: [0.1, -0.1, 0, 0.1, 0, -0.1, 0.1, 0.2, -0.1, 0, 0.1, -0.1, 0] },
  { indicator: "FOMC Rate Decision", period: "Sep 2026", releaseAt: et("2026-09-16", 14, 0), releaseTimeKnown: true, status: "released", unit: "% (upper bound)", actual: 4.25, consensus: 4.25, consensusSource: "Demo consensus panel (synthetic)", prior: 4.5, revisedPrior: 4.5, hist: [] },
  { indicator: "Initial Jobless Claims", period: "w/e Oct 10", releaseAt: et("2026-10-15", 8, 30), releaseTimeKnown: true, status: "upcoming", unit: "K", actual: null, consensus: 228, consensusSource: "Demo consensus panel (synthetic)", prior: 221, revisedPrior: null, hist: [] },
  { indicator: "FOMC Rate Decision", period: "Oct 2026", releaseAt: et("2026-10-28", 14, 0), releaseTimeKnown: true, status: "upcoming", unit: "% (upper bound)", actual: null, consensus: 4.25, consensusSource: "Demo consensus panel (synthetic)", prior: 4.25, revisedPrior: null, hist: [] },
  { indicator: "Core PCE", period: "Sep 2026", releaseAt: et("2026-10-30", 8, 30), releaseTimeKnown: true, status: "upcoming", unit: "%", actual: null, consensus: 2.9, consensusSource: "Demo consensus panel (synthetic)", prior: 2.9, revisedPrior: null, hist: [] },
  { indicator: "Nonfarm Payrolls", period: "Oct 2026", releaseAt: et("2026-11-06", 8, 30), releaseTimeKnown: true, status: "upcoming", unit: "K", actual: null, consensus: 150, consensusSource: "Demo consensus panel (synthetic)", prior: 254, revisedPrior: null, hist: [] },
];

export async function demoMacro(): Promise<{ mode: ModeInfo; rows: MacroRow[] }> {
  const w = await getDemoWorld();
  const rows: MacroRow[] = [];
  for (const r of demoArticles()) {
    const m = r.structured?.macro;
    if (!m) continue;
    const ev = w.events.find((e) => e.macro?.indicator === m.indicator && e.firstPublishedAt === r.publishedAt);
    rows.push({
      id: r.providerId,
      indicator: m.indicator,
      period: m.period,
      releaseAt: r.publishedAt!,
      releaseTimeKnown: true,
      status: "released",
      unit: m.unit,
      actual: m.actual,
      consensus: m.consensus?.value ?? null,
      consensusSource: m.consensus?.source ?? null,
      prior: m.prior,
      revisedPrior: m.revisedPrior,
      surprise: computeMacroSurprise({ indicator: m.indicator, unit: m.unit, actual: m.actual, prior: m.prior, revisedPrior: m.revisedPrior }, m.consensus, m.historicalErrors),
      source: "Demo Statistics Bureau (synthetic)",
      eventId: ev?.id ?? null,
      isSynthetic: true,
    });
  }
  for (const x of MACRO_EXTRA) {
    rows.push({
      id: `macro-${x.indicator}-${x.period}`.replace(/\W+/g, "-").toLowerCase(),
      ...x,
      surprise:
        x.actual !== null
          ? computeMacroSurprise({ indicator: x.indicator, unit: x.unit, actual: x.actual, prior: x.prior, revisedPrior: x.revisedPrior }, x.consensus !== null ? { value: x.consensus, unit: x.unit, source: x.consensusSource ?? "", licensed: true } : null, x.hist)
          : null,
      source: "Demo Statistics Bureau (synthetic)",
      eventId: null,
      isSynthetic: true,
    });
  }
  rows.sort((a, b) => b.releaseAt.localeCompare(a.releaseAt));
  return { mode: modeInfo(w), rows };
}

export async function demoEarningsAndFilings(): Promise<{ mode: ModeInfo; earnings: EarningsRow[]; filings: FilingRow[] }> {
  const w = await getDemoWorld();
  const evOf = (pid: string) => w.events.find((e) => e.evidence.some((x) => x.internalPath === `/sources/${pid}`))?.id ?? null;
  const earnings: EarningsRow[] = [
    { id: "e-hlcn", ticker: "HLCN", name: "Halcyon Semiconductor", reportedAt: et("2026-10-13", 16, 5), status: "reported", epsActual: 1.42, epsConsensus: 1.21, consensusSource: "Demo consensus panel (synthetic)", guidance: "Raised (new range above prior)", expected: "Demo consensus EPS $1.21; outlook unchanged", changed: "EPS beat; full-year revenue outlook raised", matters: "Accelerator demand read-through to documented foundry supplier and customers", nextConfirmation: "Customer capex commentary (ORBT, est. Oct 20)", eventId: evOf("hlcn-q3-pr"), isSynthetic: true },
    { id: "e-mrda", ticker: "MRDA", name: "Meridian Air", reportedAt: et("2026-10-13", 16, 10), status: "reported", epsActual: 0.38, epsConsensus: 0.52, consensusSource: "Demo consensus panel (synthetic)", guidance: "Lowered", expected: "Demo consensus EPS $0.52", changed: "EPS miss; outlook lowered on fuel and labor", matters: "Fuel sensitivity compounds today's crude supply shock", nextConfirmation: "Investor day (tentative Nov 3)", eventId: evOf("mrda-q3-pr"), isSynthetic: true },
    { id: "e-qntm-pre", ticker: "QNTM", name: "Quantum Logic Devices", reportedAt: et("2026-10-14", 14, 18), status: "reported", epsActual: null, epsConsensus: null, consensusSource: null, guidance: "None (preliminary)", expected: "Revenue growth ~2.0% (as cited by reports)", changed: "Two reports disagree: 4.1% vs 3.1% growth", matters: "Source conflict blocks a numeric estimate until the filing", nextConfirmation: "Official results (Oct 15, post-market)", eventId: evOf("qntm-prelim-a"), isSynthetic: true },
    { id: "e-qntm", ticker: "QNTM", name: "Quantum Logic Devices", reportedAt: et("2026-10-15", 16, 5), status: "upcoming", epsActual: null, epsConsensus: 0.88, consensusSource: "Demo consensus panel (synthetic)", guidance: "—", expected: "Demo consensus EPS $0.88", changed: "—", matters: "Resolves today's conflicting preliminary reports", nextConfirmation: "8-K Item 2.02", eventId: null, isSynthetic: true },
    { id: "e-orbt", ticker: "ORBT", name: "Orbital Cloud Systems", reportedAt: et("2026-10-20", 16, 5), status: "upcoming", epsActual: null, epsConsensus: null, consensusSource: null, guidance: "—", expected: "No licensed consensus in demo", changed: "—", matters: "Largest documented HLCN customer; capex guidance is the read-through", nextConfirmation: "Date estimated — not confirmed by the company", eventId: null, isSynthetic: true },
  ];
  const filings: FilingRow[] = [];
  for (const r of demoArticles()) {
    const f = r.structured?.filing;
    if (!f) continue;
    const sec = w.master.byCik(f.cik);
    filings.push({ id: r.providerId, ticker: sec?.ticker ?? null, company: sec?.name ?? `CIK ${f.cik}`, form: f.form, items: f.items, acceptedAt: f.acceptedAt, accession: f.accession, isAmendment: f.isAmendment, amends: f.amends, link: `/sources/${r.providerId}`, eventId: evOf(r.providerId), isSynthetic: true });
  }
  filings.push(
    { id: "orbt-10q", ticker: "ORBT", company: "Orbital Cloud Systems", form: "10-Q", items: [], acceptedAt: et("2026-10-09", 16, 31), accession: "0009000004-26-000210", isAmendment: false, amends: null, link: "/filings#orbt-10q", eventId: null, isSynthetic: true },
    { id: "hlcn-8k-202", ticker: "HLCN", company: "Halcyon Semiconductor", form: "8-K", items: ["2.02", "9.01"], acceptedAt: et("2026-10-13", 16, 7), accession: "0009000001-26-000188", isAmendment: false, amends: null, link: "/filings#hlcn-8k-202", eventId: evOf("hlcn-q3-pr"), isSynthetic: true },
    { id: "plsn-8ka", ticker: "PLSN", company: "Polestone Networks", form: "8-K/A", items: ["1.05"], acceptedAt: et("2026-10-14", 14, 26), accession: "0009000006-26-000104", isAmendment: true, amends: "0009000006-26-000101", link: "/filings#plsn-8ka", eventId: evOf("plsn-8k-105"), isSynthetic: true },
  );
  filings.sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt));
  return { mode: modeInfo(w), earnings, filings };
}

export async function demoCalendar(): Promise<CalendarItem[]> {
  const w = await getDemoWorld();
  return w.catalysts.map((c) => ({ ...c, source: "Demo catalyst schedule (synthetic)", isSynthetic: true }));
}

export async function demoScorecardView(opts: { from?: string; to?: string; minSample?: number }): Promise<ScorecardView> {
  const w = await getDemoWorld();
  return {
    mode: modeInfo(w),
    scorecard: demoScorecard(w, opts),
    modelVersion: w.model.version,
    note: "Synthetic walk-forward backtest. It demonstrates the evaluation machinery on a known data-generating process and is not evidence of real-world predictive skill.",
  };
}

export async function demoArchive(q: ArchiveQuery): Promise<ArchiveView> {
  const w = await getDemoWorld();
  let rows = w.archive.filter((a) => a.sample !== "in_sample");
  if (q.ticker) rows = rows.filter((a) => a.forecast.ticker === q.ticker!.toUpperCase());
  if (q.horizon) rows = rows.filter((a) => a.forecast.horizon === q.horizon);
  if (q.sample) rows = rows.filter((a) => (q.sample === "current" ? a.sample === "live_demo" : a.sample === q.sample));
  if (q.status) rows = rows.filter((a) => (q.status === "pending" ? !a.realization || a.realization.status === "pending" : a.realization?.status === q.status));
  rows = [...rows].sort((a, b) => b.forecast.forecastGeneratedAt.localeCompare(a.forecast.forecastGeneratedAt) || b.forecast.revision - a.forecast.revision);
  const limit = q.limit ?? 50;
  const cur = decodeCursor(q.cursor);
  const offset = cur && cur.a === w.anchor.toISOString() ? cur.o : 0;
  const counts: Record<string, number> = {};
  for (const a of w.archive) counts[a.sample] = (counts[a.sample] ?? 0) + 1;
  return {
    mode: modeInfo(w),
    rows: rows.slice(offset, offset + limit).map((a) => ({ forecast: a.forecast, realization: a.realization, eventTitle: a.eventTitle, eventId: a.eventId, sample: a.sample === "live_demo" ? "current" : a.sample, superseded: a.superseded })),
    total: rows.length,
    nextCursor: offset + limit < rows.length ? encodeCursor(offset + limit, w.anchor.toISOString()) : null,
    counts,
  };
}

export async function demoStatus(): Promise<StatusView> {
  const w = await getDemoWorld();
  const feed = await demoFeed({ limit: 1 });
  const notConfigured = (id: string, name: string, caps: string[], note: string) => ({
    id,
    name,
    capabilities: caps,
    configured: false,
    entitled: false,
    status: "not_configured" as const,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    latencyP50Ms: null,
    latencyP95Ms: null,
    requests: 0,
    failures: 0,
    circuit: "closed" as const,
    note,
  });
  return {
    mode: modeInfo(w),
    providers: [
      { ...notConfigured("demo", "Synthetic demo generator", ["news", "filings", "macro", "prices", "consensus"], "Deterministic synthetic world. Never mixed with live feeds."), configured: true, entitled: true, status: "synthetic", lastSuccessAt: w.anchor.toISOString(), requests: 1 },
      notConfigured("fmp", "Financial Modeling Prep", ["company_news", "prices", "macro_calendar", "earnings_calendar"], "Set FMP_API_KEY and confirm display license (FMP_DISPLAY_LICENSE=confirmed)."),
      notConfigured("massive", "Massive (formerly Polygon)", ["company_news", "prices"], "Set MASSIVE_API_KEY; public display requires an appropriate commercial license."),
      notConfigured("sec", "SEC EDGAR", ["filings", "symbol_directory"], "Public data; set SEC_USER_AGENT (name + email) per SEC fair-access policy."),
      notConfigured("fred", "FRED / ALFRED", ["macro_observations", "vintages", "release_dates"], "Set FRED_API_KEY. FRED does not provide survey consensus."),
      notConfigured("anthropic", "Anthropic (extraction only)", ["llm_extraction"], "Set ANTHROPIC_API_KEY and LLM_PROCESSING_ALLOWED=true only if vendor agreements permit."),
      notConfigured("options", "Options chain", ["options"], "No options provider integrated; implied-move module stays unavailable."),
    ],
    freshness: feed.freshness,
    pipeline: { stages: w.pipeline.stages, deadLetters: w.pipeline.deadLetters, quarantined: w.pipeline.quarantined, skippedDuplicates: w.pipeline.skippedDuplicates, licenseBlocked: w.pipeline.licenseBlocked, ms: w.pipeline.ms, ranAt: w.anchor.toISOString() },
    model: {
      version: w.model.version,
      methodology: w.model.methodology,
      trainingCutoff: w.model.trainingCutoff,
      calibrationEnd: w.model.calibrationEnd,
      isSynthetic: true,
      horizons: Object.values(w.model.horizons).map((h) => ({ horizon: h!.horizon, trainN: h!.trainN, calN: h!.calN, calibrated: h!.calibrated, coverage: h!.calibrationCoverage, ece: h!.calibrationEce, note: h!.calibrationNote, lambda: h!.prior.lambda })),
    },
    jobs: [{ id: "demo-build", kind: "demo_world_build", status: "ok", startedAt: w.anchor.toISOString(), finishedAt: w.anchor.toISOString(), detail: `Synthetic world built in ${w.buildMs} ms (${w.history.length} historical events, ${w.events.length} current events).` }],
    buildMs: w.buildMs,
  };
}

export async function demoSearch(q: string): Promise<SearchHit[]> {
  const w = await getDemoWorld();
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const tickers = w.master.securities
    .filter((s) => s.ticker.toLowerCase().startsWith(needle) || s.name.toLowerCase().includes(needle))
    .slice(0, 6)
    .map((s) => ({ kind: "ticker" as const, id: s.id, label: s.ticker, sublabel: s.name, href: `/ticker/${s.ticker}` }));
  const events = w.events
    .filter((e) => `${e.bottomLine} ${e.originalTitle} ${e.subtype}`.toLowerCase().includes(needle))
    .slice(0, 6)
    .map((e) => ({ kind: "event" as const, id: e.id, label: e.originalTitle, sublabel: e.subtype, href: `/events/${e.id}` }));
  return [...tickers, ...events];
}

export async function demoSource(id: string): Promise<SourceDocument | null> {
  const w = await getDemoWorld();
  const r = demoArticles().find((x) => x.providerId === id);
  if (!r) return null;
  const ev = w.events.find((e) => e.evidence.some((x) => x.internalPath === `/sources/${id}`));
  return {
    id,
    title: r.title,
    excerpt: r.excerpt,
    publisher: r.publisher,
    publishedAt: r.publishedAt,
    kind: r.kind,
    isSynthetic: true,
    structuredText: structuredSourceText(r),
    eventId: ev?.id ?? null,
    injectionFlags: detectInjection(`${r.title} ${r.excerpt}`),
  };
}

export async function demoSecurities() {
  const w = await getDemoWorld();
  return w.master.securities;
}
