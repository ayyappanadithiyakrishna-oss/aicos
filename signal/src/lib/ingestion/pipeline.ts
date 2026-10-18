/**
 * Article analysis pipeline:
 * fetch → source validation → canonicalization → language/symbol detection → clustering →
 * factual extraction → evidence check → mechanism mapping → exposure verification →
 * quantitative scoring → explanation → editorial checks → (persist / publish by caller).
 *
 * Every stage records status, counts and timing. Per-cluster failures go to a dead-letter list
 * instead of aborting the batch. Idempotency: records are keyed by content hash and canonical URL.
 */
import type {
  Analog,
  ConfirmationStatus,
  DataMode,
  EarningsSurprise,
  Evidence,
  Exposure,
  ForecastRealization,
  ForecastSnapshot,
  IntelligenceEvent,
  MacroSurprise,
  ProvenanceTag,
  QuarantinedSymbol,
  Severity,
  Source,
  TimelineEntry,
} from "@/lib/domain/types";
import { HORIZONS } from "@/lib/domain/types";
import { horizonWindow } from "@/lib/calendar/horizons";
import { sessionOn } from "@/lib/calendar/nyse";
import { dateKeyOf } from "@/lib/calendar/time";
import { canonicalUrl, contentHash, detectLanguage } from "@/lib/analysis/canonicalize";
import { clusterArticles, clusterKind, type ClusterInput } from "@/lib/analysis/cluster";
import { findContradictions } from "@/lib/analysis/contradiction";
import { checkFacts, verifyNumbers, type EvidenceSource } from "@/lib/analysis/evidence";
import { explain, structuredSourceText } from "@/lib/analysis/explain";
import { classify, extractDeterministic, type ExtractArticle } from "@/lib/analysis/extract";
import { computeMacroSurprise, UnitMismatchError } from "@/lib/analysis/macro";
import { buildMechanism, forecastPath, type MechanismContext, type Shock } from "@/lib/analysis/mechanisms";
import { eventQuality } from "@/lib/analysis/quality";
import { relevance } from "@/lib/analysis/ranking";
import type { Extraction } from "@/lib/analysis/schema";
import type { SecurityMaster } from "@/lib/analysis/securityMaster";
import { checkProse } from "@/lib/analysis/editorial";
import { surpriseBucket, PointInTimeView, priceAsOf, trailingBeta, trailingDailyVol } from "@/lib/quant/features";
import { buildForecast } from "@/lib/quant/forecast";
import type { EventReactionModel } from "@/lib/quant/model";
import { pricedIn } from "@/lib/quant/pricedIn";
import { resolveForecast } from "@/lib/quant/resolve";
import { hashHex } from "@/lib/quant/stats";
import { sanitizeText, safeExternalUrl } from "@/lib/security/sanitize";
import type { PriceStore } from "./priceStore";
import { withRetry } from "./retry";
import type { DeadLetter, RawRecord, StageName, StageStatus } from "./types";

export const MAX_CARD_EXPOSURES = 5;
export const OVERLAP_WINDOW_MINUTES = 60;

export interface PipelineContext {
  mode: DataMode;
  master: SecurityMaster;
  sources: ReadonlyMap<string, Source>;
  model: EventReactionModel | null;
  prices: PriceStore;
  /** Analysis instant: forecasts are generated as of this time (or the record's ingest time if earlier). */
  now: Date;
  providerStale: (provider: string) => boolean;
  analogs?: (subtype: string, bucket: string, excludeEventId: string) => { analogs: Analog[]; note: string };
  llm?: ((args: { eventId: string; articles: ExtractArticle[]; generatedAt: string; entities: Extraction["entities"] }) => Promise<Extraction>) | null;
  /** Previously processed idempotency keys (content hashes). */
  seen?: ReadonlySet<string>;
  /** Minutes between ingest and forecast generation (pipeline latency). */
  scoringLagMinutes?: number;
  /** Latest stored forecast per `${eventId}|${securityId}|${horizon}`; changes create linked revisions. */
  priorForecasts?: ReadonlyMap<string, ForecastSnapshot>;
}

export const forecastKey = (f: Pick<ForecastSnapshot, "eventId" | "securityId" | "horizon">) => `${f.eventId}|${f.securityId}|${f.horizon}`;

function materiallySame(a: ForecastSnapshot, b: ForecastSnapshot): boolean {
  return (
    a.qualityTier === b.qualityTier &&
    a.direction === b.direction &&
    a.centralMovePct === b.centralMovePct &&
    a.intervalLowPct === b.intervalLowPct &&
    a.intervalHighPct === b.intervalHighPct &&
    JSON.stringify(a.probabilities) === JSON.stringify(b.probabilities) &&
    a.modelVersion === b.modelVersion &&
    a.reasonCodes.join() === b.reasonCodes.join()
  );
}

export interface PipelineResult {
  events: IntelligenceEvent[];
  stages: StageStatus[];
  deadLetters: DeadLetter[];
  quarantined: QuarantinedSymbol[];
  processedKeys: string[];
  skippedDuplicates: number;
  licenseBlocked: number;
  /** Prior snapshots superseded by a new revision in this run (kept, never overwritten). */
  superseded: ForecastSnapshot[];
}

interface Prepared {
  id: string;
  key: string;
  record: RawRecord;
  entityIds: string[];
  quarantined: QuarantinedSymbol[];
  verified: Array<{ securityId: string; how: string }>;
  publishedAt: string;
  publishedAtKnown: boolean;
}

class StageTimer {
  readonly stages: StageStatus[] = [];
  async run<T>(stage: StageName, fn: () => Promise<T> | T, count: (t: T) => number): Promise<T> {
    const t0 = performance.now();
    try {
      const out = await fn();
      this.stages.push({ stage, status: "ok", count: count(out), ms: Math.round(performance.now() - t0), attempts: 1 });
      return out;
    } catch (e) {
      this.stages.push({ stage, status: "failed", count: 0, ms: Math.round(performance.now() - t0), attempts: 1, error: String(e) });
      throw e;
    }
  }
  add(stage: StageName, count: number, ms: number, status: StageStatus["status"] = "ok", error?: string): void {
    this.stages.push({ stage, status, count, ms: Math.round(ms), attempts: 1, error });
  }
}

export async function runPipeline(records: readonly RawRecord[], ctx: PipelineContext): Promise<PipelineResult> {
  const timer = new StageTimer();
  const deadLetters: DeadLetter[] = [];
  let licenseBlocked = 0;
  let skippedDuplicates = 0;

  // 1. Source validation and display-license gate.
  const valid = await timer.run(
    "validate_source",
    () =>
      records.filter((r) => {
        const src = ctx.sources.get(r.sourceId);
        if (!src) return false;
        if (ctx.mode === "live" && !src.displayLicensed) {
          licenseBlocked++;
          return false;
        }
        if (ctx.mode === "live" && r.isSynthetic) return false; // synthetic never leaks into live feeds
        if (ctx.mode === "demo" && !r.isSynthetic) return false; // and live never mixes into demo
        return true;
      }),
    (x) => x.length,
  );

  // 2. Canonicalize, sanitize, dedupe (idempotency).
  const prepared0 = await timer.run(
    "canonicalize",
    () => {
      const seenUrl = new Set<string>();
      const seenHash = new Set<string>(ctx.seen ?? []);
      const out: Array<Omit<Prepared, "entityIds" | "quarantined" | "verified">> = [];
      for (const r of valid) {
        const title = sanitizeText(r.title, 300);
        const excerpt = sanitizeText(r.excerpt, 1200);
        const url = safeExternalUrl(r.url) ?? r.url;
        const cu = canonicalUrl(url);
        const key = contentHash([r.sourceId, title, excerpt]);
        if (seenUrl.has(cu) || seenHash.has(key)) {
          skippedDuplicates++;
          continue;
        }
        seenUrl.add(cu);
        seenHash.add(key);
        const publishedAtKnown = Boolean(r.publishedAt && Number.isFinite(Date.parse(r.publishedAt)));
        out.push({
          id: `ar_${hashHex(`${r.provider}|${r.providerId}`)}`,
          key,
          record: { ...r, title, excerpt, url },
          publishedAt: publishedAtKnown ? new Date(r.publishedAt!).toISOString() : r.fetchedAt,
          publishedAtKnown,
        });
      }
      return out;
    },
    (x) => x.length,
  );

  // 3. Language and symbol detection against the security master.
  const allQuarantined: QuarantinedSymbol[] = [];
  const prepared = await timer.run(
    "detect",
    () =>
      prepared0
        .filter((p) => detectLanguage(`${p.record.title} ${p.record.excerpt}`) === "en")
        .map((p) => {
          const r = p.record;
          let verified: Prepared["verified"] = [];
          let quarantined: QuarantinedSymbol[] = [];
          if (r.structured?.filing) {
            const sec = ctx.master.byCik(r.structured.filing.cik);
            if (sec) verified = [{ securityId: sec.id, how: "filer_cik" }];
            else quarantined = [{ symbol: `CIK ${r.structured.filing.cik}`, reason: "Filer CIK not in security master", articleId: p.id }];
          } else {
            const res = ctx.master.resolve(`${r.title} ${r.excerpt}`, r.tickers, p.publishedAt, p.id);
            verified = res.verified.map((v) => ({ securityId: v.security.id, how: v.how }));
            quarantined = res.quarantined;
          }
          allQuarantined.push(...quarantined);
          return { ...p, verified, quarantined, entityIds: verified.map((v) => v.securityId) } satisfies Prepared;
        }),
    (x) => x.length,
  );

  // 4. Cluster.
  const clusters = await timer.run(
    "cluster",
    () =>
      clusterArticles(
        prepared.map(
          (p): ClusterInput => ({
            id: p.id,
            title: p.record.title,
            excerpt: p.record.excerpt,
            publishedAt: p.publishedAt,
            publisher: p.record.publisher,
            entityIds: p.entityIds,
            kindHint: clusterKind(classify(p.record).subtype),
            isOriginalDisclosure: p.record.isOriginalDisclosure,
          }),
        ),
      ),
    (x) => x.length,
  );
  const byId = new Map(prepared.map((p) => [p.id, p] as const));

  // 5. Per-cluster analysis, isolated so one failure cannot poison the batch.
  type Draft = Awaited<ReturnType<typeof analyzeCluster>>;
  const drafts: Draft[] = [];
  const stageMs: Record<string, number> = {};
  for (const cl of clusters) {
    const members = cl.articleIds.map((id) => byId.get(id)!).filter(Boolean);
    try {
      const { value } = await withRetry(() => analyzeCluster(cl, members, ctx, stageMs), { attempts: ctx.llm ? 3 : 1, key: cl.id, baseMs: 200 });
      drafts.push(value);
    } catch (e) {
      deadLetters.push({ key: cl.id, stage: "extract", error: String(e instanceof Error ? e.message : e), at: ctx.now.toISOString(), payloadRef: members.map((m) => m.id).join(",") });
    }
  }
  for (const s of ["extract", "evidence_check", "mechanisms", "exposure"] as const) timer.add(s, drafts.length, stageMs[s] ?? 0);

  // 6. Overlap detection across clusters (shared exposures within the window).
  for (const a of drafts) {
    for (const b of drafts) {
      if (a === b) continue;
      const dt = Math.abs(Date.parse(a.firstPublishedAt) - Date.parse(b.firstPublishedAt)) / 60000;
      if (dt > OVERLAP_WINDOW_MINUTES) continue;
      const sa = new Set(a.exposures.map((e) => e.securityId));
      if (b.exposures.some((e) => sa.has(e.securityId))) a.overlapsWith.push(b.id);
    }
  }

  // 7. Quantitative scoring, explanation, editorial checks.
  const t7 = performance.now();
  const events: IntelligenceEvent[] = [];
  const superseded: ForecastSnapshot[] = [];
  for (const d of drafts) {
    try {
      events.push(scoreAndAssemble(d, ctx, superseded));
    } catch (e) {
      deadLetters.push({ key: d.id, stage: "score", error: String(e instanceof Error ? e.message : e), at: ctx.now.toISOString(), payloadRef: d.articleIds.join(",") });
    }
  }
  timer.add("score", events.length, performance.now() - t7);
  timer.add("explain", events.length, 0);
  timer.add("editorial", events.length, 0, events.some((e) => e.limitations.some((l) => l.startsWith("Editorial"))) ? "ok" : "ok");

  // 8. Relevance ranking.
  const capBuckets = Object.fromEntries(ctx.master.securities.map((s) => [s.id, s.marketCapBucket] as const));
  for (const e of events) e.relevance = relevance(e, { now: ctx.now, capBuckets });
  events.sort((a, b) => b.relevance.score - a.relevance.score);
  timer.add("publish", events.length, 0);

  return {
    events,
    stages: timer.stages,
    deadLetters,
    quarantined: allQuarantined,
    processedKeys: prepared.map((p) => p.key),
    skippedDuplicates,
    licenseBlocked,
    superseded,
  };
}

// ---------------------------------------------------------------------------------------------

async function analyzeCluster(
  cl: ReturnType<typeof clusterArticles>[number],
  members: Prepared[],
  ctx: PipelineContext,
  stageMs: Record<string, number>,
) {
  const tick = (k: string, t0: number) => (stageMs[k] = (stageMs[k] ?? 0) + (performance.now() - t0));
  const primary = members.find((m) => m.record.isOriginalDisclosure) ?? members[0]!;
  const eventId = `ev_${hashHex(cl.id)}`;
  const evidenceIdOf = (m: Prepared) => `evd_${hashHex(m.id)}`;
  const evidence: Evidence[] = members.map((m) => ({
    id: evidenceIdOf(m),
    articleId: m.id,
    url: m.record.url,
    publisher: m.record.publisher,
    publishedAt: m.publishedAt,
    kind:
      m.record.kind === "filing"
        ? "filing"
        : m.record.kind === "macro_release"
          ? "official_release"
          : m.record.kind === "press_release"
            ? "company_statement"
            : ctx.sources.get(m.record.sourceId)?.kind === "wire"
              ? "wire"
              : "news",
    isOriginal: m.record.isOriginalDisclosure,
    excerpt: m.record.excerpt.slice(0, 280),
    internalPath: m.record.internalPath ?? null,
  }));
  const evSources: EvidenceSource[] = members.map((m, i) => ({ evidence: evidence[i]!, text: structuredSourceText(m.record) }));

  // Extraction
  let t0 = performance.now();
  const entityList = [...new Set(members.flatMap((m) => m.entityIds))]
    .map((id) => ctx.master.byId(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  const extractArticles: ExtractArticle[] = members.map((m) => ({ evidenceId: evidenceIdOf(m), record: m.record }));
  const entitiesForContract = entityList.map((s) => ({ ticker: s.ticker, entityId: s.id, directness: "direct" as const, mechanism: "Named in source", verified: true }));
  let extraction: Extraction;
  let extractionMethod: IntelligenceEvent["extractionMethod"] = "deterministic";
  // Forecasts are (re)generated when the newest evidence in the cluster was ingested.
  const newestFetch = Math.max(...members.map((m) => Date.parse(m.record.fetchedAt)));
  const generatedAt = new Date(Math.min(ctx.now.getTime(), newestFetch + (ctx.scoringLagMinutes ?? 2) * 60000)).toISOString();
  if (ctx.llm) {
    extraction = await ctx.llm({ eventId, articles: extractArticles, generatedAt, entities: entitiesForContract });
    extractionMethod = "llm_validated";
  } else {
    extraction = extractDeterministic({ eventId, articles: extractArticles, entities: entitiesForContract, generatedAt });
  }
  tick("extract", t0);

  // Evidence check
  t0 = performance.now();
  const numberCheck = verifyNumbers(extraction.numbers, evSources);
  tick("evidence_check", t0);

  // Shock / bucket / issuer context
  const macroRaw = primary.record.structured?.macro;
  let macro: MacroSurprise | null = null;
  const limitations = [...extraction.limitations];
  if (macroRaw) {
    try {
      macro = computeMacroSurprise(
        { indicator: macroRaw.indicator, unit: macroRaw.unit, actual: macroRaw.actual, prior: macroRaw.prior, revisedPrior: macroRaw.revisedPrior },
        macroRaw.consensus,
        macroRaw.historicalErrors,
      );
    } catch (e) {
      if (e instanceof UnitMismatchError) limitations.push(e.message);
      else throw e;
    }
  }
  const er = primary.record.structured?.earnings;
  const earnings: EarningsSurprise | null = er
    ? { ...er }
    : extraction.guidance !== "none" && extraction.subtype.startsWith("earnings")
      ? { epsActual: null, epsConsensus: null, revenueActual: null, revenueConsensus: null, consensusSource: null, guidance: extraction.guidance, surpriseZ: null }
      : null;
  const subtype = ctx.llm ? classify(primary.record).subtype : extraction.subtype;
  const text = members.map((m) => `${m.record.title} ${m.record.excerpt}`).join(" ");
  let shock: Shock = 0;
  let magnitudeZ: number | null = null;
  let bucket = "na";
  if (macro) {
    magnitudeZ = macro.surpriseZ;
    shock = macro.surprise === null || macro.surprise === 0 ? 0 : macro.surprise > 0 ? 1 : -1;
    bucket = surpriseBucket(macro.surpriseZ);
    if (macro.surpriseZ !== null && Math.abs(macro.surpriseZ) < 0.5) shock = 0;
  } else if (earnings) {
    magnitudeZ = earnings.surpriseZ;
    if (earnings.surpriseZ !== null) {
      shock = earnings.surpriseZ > 0.25 ? 1 : earnings.surpriseZ < -0.25 ? -1 : 0;
      bucket = surpriseBucket(earnings.surpriseZ);
    } else if (earnings.guidance === "raised" || earnings.guidance === "initiated") {
      shock = 1;
      bucket = "guide_up";
    } else if (earnings.guidance === "lowered" || earnings.guidance === "withdrawn") {
      shock = -1;
      bucket = "guide_down";
    }
  } else if (subtype.startsWith("earnings.")) {
    // No structured consensus: use verified actual-vs-expected pairs from the provided text, sign only.
    const actual = numberCheck.verified.find((n) => n.role === "actual");
    const expected = actual ? numberCheck.verified.find((n) => n.role === "consensus" && n.name === actual.name && n.evidenceId === actual.evidenceId) : undefined;
    if (actual && expected && actual.value !== expected.value) {
      shock = actual.value > expected.value ? 1 : -1;
      bucket = shock > 0 ? "beat_unmeasured" : "miss_unmeasured";
    }
  } else if (subtype === "filing.insider_form4") {
    if (/\b(purchase|bought|buys)\b/i.test(text)) {
      shock = 1;
      bucket = "insider_buy";
    } else if (/\b(sale|sold|sells)\b/i.test(text)) {
      shock = -1;
      bucket = "insider_sell";
    }
  } else if (subtype.startsWith("ma.")) {
    shock = 1;
    bucket = extraction.dealRole === "acquirer" ? "acquirer" : "target";
  } else if (subtype === "regulation.drug_approval") {
    shock = /\b(approves|approval granted|approved)\b/i.test(text) && !/\b(rejects|complete response)\b/i.test(text) ? 1 : -1;
    bucket = shock > 0 ? "approve" : "reject";
  } else if (subtype === "geopolitics.oil_supply" || subtype === "sector.supply_shortage" || subtype === "company.buyback") {
    shock = 1;
  } else if (["sector.price_war", "regulation.antitrust", "regulation.export_controls", "company.cyber_incident", "company.recall", "company.credit_downgrade", "company.restatement", "company.impairment", "company.delisting_notice"].includes(subtype)) {
    shock = -1;
  }

  const deal = primary.record.structured?.deal;
  const issuer = (() => {
    if (primary.record.structured?.filing) return ctx.master.byCik(primary.record.structured.filing.cik);
    const direct = primary.entityIds.map((id) => ctx.master.byId(id)).filter((s) => s && s.kind === "equity");
    return direct[0] ?? null;
  })();
  const counterparty = deal?.counterpartyTicker ? ctx.master.byTicker(deal.counterpartyTicker, primary.publishedAt) : null;
  const mctx: MechanismContext = {
    subtype,
    shock,
    magnitudeZ,
    bucket,
    issuer,
    counterparty,
    dealRole: deal?.role ?? extraction.dealRole,
    guidance: extraction.guidance,
    indicatorLabel: macroRaw ? `${macroRaw.indicator}` : null,
    master: ctx.master,
  };
  t0 = performance.now();
  const mech = buildMechanism(mctx);
  tick("mechanisms", t0);

  // Exposure verification: candidates must resolve in the master; support becomes data evidence.
  t0 = performance.now();
  const seenSec = new Set<string>();
  const exposures: Exposure[] = [];
  const channelKeys = new Map<string, string>();
  const hypothesizedBySec = new Map<string, boolean>();
  for (const c of mech.exposures) {
    if (seenSec.has(c.security.id) || !ctx.master.byId(c.security.id)) continue;
    seenSec.add(c.security.id);
    const supportIds: string[] = [];
    for (const s of c.support) {
      const id = `evd_${hashHex(`${eventId}|${s.text}`)}`;
      if (!evidence.some((e) => e.id === id)) {
        evidence.push({ id, articleId: null, url: s.path ?? "", publisher: ctx.mode === "demo" ? "Security master (synthetic)" : "Security master", publishedAt: primary.publishedAt, kind: "data", isOriginal: false, excerpt: s.text, internalPath: s.path });
      }
      supportIds.push(id);
    }
    const directEvidence = c.directness === "direct" ? [evidenceIdOf(primary)] : [];
    exposures.push({
      securityId: c.security.id,
      ticker: c.security.ticker,
      name: c.security.name,
      directness: c.directness,
      relationship: c.relationship,
      mechanism: c.mechanism,
      sign: c.sign,
      severity: c.severity,
      verified: true,
      evidenceIds: [...directEvidence, ...supportIds],
      linkage: c.linkage,
    });
    channelKeys.set(c.security.id, c.channelKey);
    hypothesizedBySec.set(c.security.id, c.hypothesized);
  }
  // Direct exposures first, then by severity.
  const sevRank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  exposures.sort((a, b) => (a.directness === b.directness ? sevRank[a.severity] - sevRank[b.severity] : a.directness === "direct" ? -1 : 1));
  tick("exposure", t0);

  // Facts: deterministic facts from structured fields + model facts (if any), all evidence-checked.
  const expl = explain({ ctx: mctx, mech, exposures, macro, primary: primary.record, evidenceIdByProviderId: new Map(members.map((m) => [m.record.providerId, evidenceIdOf(m)])) });
  const modelFacts = extractionMethod === "llm_validated" ? extraction.summary.verifiedFacts.map((f) => ({ ...f, label: "confirmed_fact" as const })) : [];
  const factCheck = checkFacts([...expl.facts, ...modelFacts], evSources);
  let bottomLine = expl.bottomLine;
  if (extractionMethod === "llm_validated") {
    const candidate = extraction.summary.bottomLine;
    const ok = !/\d/.test(candidate) && checkProse(candidate).ok && candidate.split(/\s+/).length >= 15 && candidate.split(/\s+/).length <= 25;
    if (ok) bottomLine = candidate;
  }
  if (expl.editorialIssues.length) limitations.push(`Editorial fallback applied: ${expl.editorialIssues.join("; ")}`);
  if (factCheck.dropped.length) limitations.push(`${factCheck.dropped.length} extracted fact(s) dropped for failing evidence checks.`);
  if (!numberCheck.highImpactVerified) limitations.push("High-impact numbers could not be verified against the cited source; quantitative estimates suppressed.");

  // Source conflicts: same number name/role with different values across documents.
  const sourceConflicts: Array<{ text: string; evidenceIds: string[] }> = [];
  const groups = new Map<string, typeof extraction.numbers>();
  for (const n of numberCheck.verified) {
    const k = `${n.name}|${n.role}`;
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  for (const [k, ns] of groups) {
    const vals = new Set(ns.map((n) => n.value));
    if (vals.size > 1) sourceConflicts.push({ text: `Sources disagree on ${k.replace("|", " ")}: ${[...vals].join(" vs ")}.`, evidenceIds: [...new Set(ns.map((n) => n.evidenceId))] });
  }

  const src = ctx.sources.get(primary.record.sourceId)!;
  const originals = members.filter((m) => m.record.isOriginalDisclosure);
  const distinctOriginalPublishers = new Set(originals.map((m) => m.record.publisher)).size;
  const confirmation: ConfirmationStatus = members.some((m) => m.record.kind === "filing")
    ? "confirmed_filing"
    : members.some((m) => m.record.kind === "macro_release")
      ? "official_release"
      : distinctOriginalPublishers >= 2
        ? "multiple_independent"
        : src.reliability >= 0.5
          ? "single_source"
          : "unverified";

  return {
    id: eventId,
    clusterId: cl.id,
    subtype,
    eventType: ctx.llm ? classify(primary.record).type : extraction.eventType,
    primary,
    members,
    evidence,
    exposures,
    channelKeys,
    hypothesizedBySec,
    mech,
    mctx,
    bucket,
    macro,
    earnings,
    facts: factCheck.kept,
    droppedFacts: factCheck.dropped.length,
    // High-impact numbers from a single unreliable source are not independently verified.
    numericVerified:
      numberCheck.highImpactVerified &&
      !(confirmation === "unverified" && extraction.numbers.some((n) => n.role === "actual" || n.role === "consensus")),
    quantified: numberCheck.verified.length > 0,
    bottomLine,
    whyItMatters: expl.whyItMatters,
    limitations,
    sourceConflicts,
    confirmation,
    source: src,
    novelty: cl.novelty,
    firstPublishedAt: cl.firstPublishedAt,
    articleIds: cl.articleIds,
    quarantined: members.flatMap((m) => m.quarantined),
    overlapsWith: [] as string[],
    extractionMethod,
    generatedAt,
    injection: extraction.injectionFlags.length > 0,
  };
}

function scoreAndAssemble(d: Awaited<ReturnType<typeof analyzeCluster>>, ctx: PipelineContext, superseded: ForecastSnapshot[]): IntelligenceEvent {
  const publishedAt = d.firstPublishedAt;
  const forecastGeneratedAt = d.generatedAt;
  const asOf = forecastGeneratedAt;
  const pubView = new PointInTimeView(publishedAt);
  const overlapping = d.overlapsWith.length > 0;
  const bench = ctx.master.benchmark();
  const benchDaily = bench ? ctx.prices.daily(bench.id) : null;
  const benchIntraday = bench ? ctx.prices.intraday(bench.id) : null;
  const providerStale = ctx.providerStale(d.primary.record.provider);
  const provenanceBase: ProvenanceTag[] = [];
  if (ctx.prices.entitlement === "synthetic") provenanceBase.push("synthetic");
  else if (ctx.prices.entitlement === "delayed") provenanceBase.push("licensed_delayed");
  else if (ctx.prices.entitlement === "realtime") provenanceBase.push("licensed_realtime");
  if (!d.primary.publishedAtKnown) provenanceBase.push("unknown_publication_time");
  if (providerStale) provenanceBase.push("stale_feed");
  if (overlapping) provenanceBase.push("event_overlap");

  const forecasts: ForecastSnapshot[] = [];
  const realizations: ForecastRealization[] = [];
  const observed: Array<{ ticker: string; rawPct: number | null; forecast: ForecastSnapshot | null }> = [];
  for (const ex of d.exposures.slice(0, MAX_CARD_EXPOSURES + 3)) {
    const sec = ctx.master.byId(ex.securityId)!;
    const daily = ctx.prices.daily(sec.id);
    const intraday = ctx.prices.intraday(sec.id);
    const sigmaD = daily ? trailingDailyVol(pubView, daily, 60) : null;
    const beta = daily && benchDaily ? (sec.id === bench?.id ? 1 : trailingBeta(pubView, daily, benchDaily, 120)) : null;
    for (const h of HORIZONS) {
      const w = horizonWindow(new Date(publishedAt), h);
      const bars = h === "1h" ? intraday : daily;
      const baseline = bars ? priceAsOf(new PointInTimeView(new Date(Math.min(w.start.getTime(), Date.parse(asOf))).toISOString()), bars) : null;
      const sigmaHPct = sigmaD ? sigmaD * 100 * Math.sqrt(w.tradingDays) : null;
      const prov = [...provenanceBase];
      if (sec.kind !== "equity") prov.push("proxy_asset");
      if (!bars) prov.push("data_gap");
      const fctx = {
          eventId: d.id,
          securityId: sec.id,
          ticker: sec.ticker,
          horizon: h,
          forecastGeneratedAt,
          asOf,
          path: forecastPath(d.subtype, d.bucket, d.channelKeys.get(sec.id) ?? `${ex.relationship}:${ex.sign}`),
          sigmaHPct,
          baseline,
          mechanismSign: ex.sign,
          exposureVerified: ex.verified,
          numericFactsVerified: d.numericVerified,
          sourceConflict: d.sourceConflicts.length > 0,
          providerStale,
          overlapping,
          provenance: prov,
          invalidationConditions: d.mech.invalidation.slice(0, 3),
          isSynthetic: ctx.mode === "demo",
      };
      let f = buildForecast(fctx, ctx.model);
      const prior = ctx.priorForecasts?.get(forecastKey(f));
      if (prior) {
        if (materiallySame(prior, f)) f = prior;
        else {
          f = buildForecast({ ...fctx, revision: prior.revision + 1, supersedes: prior.id }, ctx.model);
          superseded.push(prior);
        }
      }
      forecasts.push(f);
      if (bars && (h === "1h" ? benchIntraday : benchDaily)) {
        const r = resolveForecast({
          forecast: f,
          publishedAt,
          assetBars: bars,
          benchmarkBars: h === "1h" ? benchIntraday : benchDaily,
          beta,
          sigmaHPct,
          now: ctx.now,
          splits: ctx.prices.splits(sec.id),
          overlapping,
        });
        realizations.push(r);
      }
    }
    const ns = forecasts.find((f) => f.securityId === sec.id && f.horizon === "next_session") ?? null;
    const pi = pricedIn({ securityId: sec.id, ticker: sec.ticker, publishedAt, analysisAt: ctx.now.toISOString(), dailyBars: daily, intradayBars: intraday });
    observed.push({ ticker: sec.ticker, rawPct: pi.realizedSincePct, forecast: ns });
  }

  const pricedInList = d.exposures.slice(0, 3).map((ex) =>
    pricedIn({
      securityId: ex.securityId,
      ticker: ex.ticker,
      publishedAt,
      analysisAt: ctx.now.toISOString(),
      dailyBars: ctx.prices.daily(ex.securityId),
      intradayBars: ctx.prices.intraday(ex.securityId),
    }),
  );

  // Observed moves on graph nodes (labelled observed, with provenance).
  const graph = {
    nodes: d.mech.graph.nodes.map((n) => {
      if (n.kind !== "security" || !n.securityId) return n;
      const o = pricedInList.find((p) => p.securityId === n.securityId) ?? null;
      const rp = o?.realizedSincePct ?? observed.find((x) => x.ticker === n.label)?.rawPct ?? null;
      return rp === null ? n : { ...n, observed: { changeLabel: `${rp >= 0 ? "+" : ""}${rp.toFixed(2)}% since publication`, provenance: (ctx.prices.entitlement === "synthetic" ? "synthetic" : "observed") as ProvenanceTag } };
    }),
    edges: d.mech.graph.edges,
  };
  const contradictions = findContradictions({
    eventId: d.id,
    counterMechanisms: d.mech.counterMechanisms,
    invalidation: d.mech.invalidation,
    sourceConflicts: d.sourceConflicts,
    forecasts,
    observed,
    graph,
  });

  const timeline: TimelineEntry[] = [];
  const first = d.members[0]!;
  timeline.push({ at: first.publishedAt, kind: first.record.kind === "filing" ? "filing" : first.record.kind === "macro_release" ? "release" : "first_report", text: `${first.record.publisher}: ${first.record.title}`, evidenceId: d.evidence[0]!.id });
  d.members.slice(1).forEach((m, i) => {
    timeline.push({
      at: m.publishedAt,
      kind: m.record.isOriginalDisclosure ? "confirmation" : "update",
      text: `${m.record.isOriginalDisclosure ? "Original disclosure" : "Follow-on coverage"} — ${m.record.publisher}: ${m.record.title}`,
      evidenceId: d.evidence[i + 1]!.id,
    });
  });
  timeline.push({ at: forecastGeneratedAt, kind: "forecast", text: `Forecasts frozen (${ctx.model?.version ?? "no model"}).`, evidenceId: null });
  for (const r of realizations) {
    if (r.status !== "resolved") continue;
    const f = forecasts.find((x) => x.id === r.forecastId)!;
    if (f.horizon !== "next_session" || f.securityId !== d.exposures[0]?.securityId) continue;
    timeline.push({ at: r.windowEnd!, kind: "market", text: `Observed ${f.ticker} ${f.horizon.replace("_", " ")} abnormal return ${r.abnormalReturnPct! >= 0 ? "+" : ""}${r.abnormalReturnPct!.toFixed(2)}%.`, evidenceId: null });
  }
  timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const ingestedAt = d.primary.record.fetchedAt;
  const quality = eventQuality({
    sourceReliability: d.source.reliability,
    verifiedFactCount: d.facts.length,
    droppedFactCount: d.droppedFacts,
    publishedAtKnown: d.primary.publishedAtKnown,
    ingestLagMinutes: Math.max(0, (Date.parse(ingestedAt) - Date.parse(publishedAt)) / 60000),
    providerStale,
    quantified: d.quantified,
    noveltyScore: d.novelty.score,
    confirmation: d.confirmation,
  });
  const sevRank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
  const maxSev = d.exposures.reduce((m, e) => Math.max(m, sevRank[e.severity]), 1);
  const z = d.macro?.surpriseZ ?? d.earnings?.surpriseZ ?? null;
  const severity: Severity = (z !== null && Math.abs(z) >= 1.5) || maxSev === 3 ? "high" : maxSev === 2 || (z !== null && Math.abs(z) >= 0.75) ? "medium" : "low";
  const ageH = (ctx.now.getTime() - Date.parse(publishedAt)) / 3_600_000;
  const sameSession = sessionOn(dateKeyOf(ctx.now))?.date === dateKeyOf(new Date(publishedAt));
  const urgency: IntelligenceEvent["urgency"] = ageH < 2 ? "breaking" : sameSession ? "today" : ageH < 72 ? "developing" : "background";
  const tags = new Set<string>([d.eventType]);
  if (severity === "high") tags.add("market_moving");
  if (d.eventType === "filing" || d.members.some((m) => m.record.kind === "filing")) tags.add("filing");
  for (const s of d.exposures.map((e) => ctx.master.byId(e.securityId)?.sector).filter(Boolean)) tags.add(`sector:${s}`);
  const analog = ctx.analogs ? ctx.analogs(d.subtype, d.bucket, d.id) : { analogs: [], note: "No historical event archive available." };
  const openQuestions = [...d.mech.openQuestions];
  if (!d.macro?.consensus && d.macro) openQuestions.unshift("No licensed consensus: what did the market expect?");

  return {
    id: d.id,
    slug: d.id,
    eventType: d.eventType,
    subtype: d.subtype,
    tags: [...tags],
    originalTitle: d.primary.record.title,
    bottomLine: d.bottomLine,
    whyItMatters: d.whyItMatters,
    verifiedFacts: d.facts,
    transmission: d.mech.transmission,
    scenario: d.mech.scenario,
    firstPublishedAt: publishedAt,
    ingestedAt,
    updatedAt: d.members.at(-1)!.publishedAt,
    asOf,
    confirmationStatus: d.confirmation,
    extractionMethod: d.extractionMethod,
    extractionConfidence: Math.round((d.numericVerified ? 0.6 : 0.3) * 100 + (d.facts.length / 3) * 30 + (d.injection ? -20 : 10)) / 100,
    exposures: d.exposures,
    quarantined: d.quarantined,
    evidence: d.evidence,
    articleIds: d.articleIds,
    graph,
    limitations: d.limitations,
    openQuestions,
    contradictions,
    invalidation: d.mech.invalidation,
    novelty: d.novelty,
    quality,
    severity,
    urgency,
    forecasts,
    realizations,
    pricedIn: pricedInList,
    overlapping,
    overlapsWith: d.overlapsWith,
    relevance: { score: 0, components: {} },
    macro: d.macro,
    earnings: d.earnings,
    analogs: analog.analogs,
    analogNote: analog.note,
    timeline,
    sectors: [...new Set(d.exposures.map((e) => ctx.master.byId(e.securityId)?.sector).filter((s): s is string => Boolean(s)))],
    region: "US",
    isSynthetic: ctx.mode === "demo",
    primarySourceName: d.source.name,
    primarySourceKind: d.source.kind,
  };
}
