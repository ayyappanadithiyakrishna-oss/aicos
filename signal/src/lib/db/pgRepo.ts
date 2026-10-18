/**
 * Postgres repository via Drizzle. Driver-agnostic: works with neon-http in production and PGlite
 * in integration tests. Forecast inserts use ON CONFLICT DO NOTHING; the database trigger rejects
 * any UPDATE/DELETE of a stored snapshot.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ForecastRealization, ForecastSnapshot, IntelligenceEvent } from "@/lib/domain/types";
import type { DeadLetter } from "@/lib/ingestion/types";
import { hashHex } from "@/lib/quant/stats";
import * as s from "./schema";
import type { AlertRecord, JobRecord, Repository, WatchlistRecord } from "./repo";

type Db = PgDatabase<PgQueryResultHKT, typeof s>;

export class PgRepository implements Repository {
  readonly kind = "postgres" as const;
  constructor(private readonly db: Db) {}

  async seenKeys(keys: string[]) {
    if (!keys.length) return new Set<string>();
    const rows = await this.db.select({ key: s.rawIngestRecords.key }).from(s.rawIngestRecords).where(inArray(s.rawIngestRecords.key, keys));
    return new Set(rows.map((r) => r.key));
  }

  async recordRaw(rows: Parameters<Repository["recordRaw"]>[0]) {
    if (!rows.length) return;
    await this.db.insert(s.rawIngestRecords).values(rows).onConflictDoNothing();
  }

  async upsertEvents(events: IntelligenceEvent[]) {
    for (const e of events) {
      const row = {
        id: e.id,
        eventType: e.eventType,
        subtype: e.subtype,
        firstPublishedAt: e.firstPublishedAt,
        updatedAt: e.updatedAt < e.firstPublishedAt ? e.firstPublishedAt : e.updatedAt,
        severity: e.severity,
        relevance: e.relevance.score,
        qualityScore: e.quality.score,
        confirmationStatus: e.confirmationStatus,
        isSynthetic: e.isSynthetic,
        payload: e,
      };
      await this.db.insert(s.eventClusters).values(row).onConflictDoUpdate({ target: s.eventClusters.id, set: { ...row, id: undefined } });
      for (const x of e.exposures) {
        if (!x.evidenceIds.length) continue;
        await this.db
          .insert(s.eventExposures)
          .values({ eventId: e.id, securityId: x.securityId, relationship: x.relationship, directness: x.directness, sign: x.sign, mechanism: x.mechanism, evidenceIds: x.evidenceIds })
          .onConflictDoNothing();
      }
    }
  }

  async insertForecasts(fs: ForecastSnapshot[]) {
    let inserted = 0;
    for (const f of fs) {
      const res = await this.db
        .insert(s.predictions)
        .values({
          id: f.id,
          eventId: f.eventId,
          securityId: f.securityId,
          horizon: f.horizon,
          forecastGeneratedAt: f.forecastGeneratedAt,
          asOf: f.asOf,
          baselinePriceTime: f.baselinePriceTime,
          baseMarketPrice: f.baseMarketPrice,
          centralMovePct: f.centralMovePct,
          intervalLowPct: f.intervalLowPct,
          intervalHighPct: f.intervalHighPct,
          probUp: f.probabilities?.up ?? null,
          probDown: f.probabilities?.down ?? null,
          probNeutral: f.probabilities?.neutral ?? null,
          direction: f.direction,
          qualityTier: f.qualityTier,
          sampleSize: f.sampleSize,
          modelVersion: f.modelVersion,
          revision: f.revision,
          supersedes: f.supersedes,
          snapshot: f,
          isSynthetic: f.isSynthetic,
        })
        .onConflictDoNothing({ target: s.predictions.id })
        .returning({ id: s.predictions.id });
      if (res.length) {
        inserted++;
        if (f.supersedes) {
          await this.db
            .insert(s.predictionRevisions)
            .values({ predictionId: f.id, supersedes: f.supersedes, reason: f.reasonCodes.join(","), createdAt: f.forecastGeneratedAt })
            .onConflictDoNothing();
        }
      }
    }
    return { inserted, existing: fs.length - inserted };
  }

  async latestForecasts(eventIds: string[]) {
    const out = new Map<string, ForecastSnapshot>();
    if (!eventIds.length) return out;
    const rows = await this.db.select({ snapshot: s.predictions.snapshot }).from(s.predictions).where(inArray(s.predictions.eventId, eventIds));
    for (const r of rows) {
      const f = r.snapshot as ForecastSnapshot;
      const k = `${f.eventId}|${f.securityId}|${f.horizon}`;
      const cur = out.get(k);
      if (!cur || f.revision > cur.revision) out.set(k, f);
    }
    return out;
  }

  async allForecasts(opts: { ticker?: string; limit?: number } = {}) {
    const q = this.db.select({ snapshot: s.predictions.snapshot }).from(s.predictions);
    const rows = await (opts.ticker ? q.where(eq(s.predictions.securityId, opts.ticker)) : q).orderBy(desc(s.predictions.forecastGeneratedAt)).limit(opts.limit ?? 500);
    return rows.map((r) => r.snapshot as ForecastSnapshot);
  }

  async upsertRealizations(rows: ForecastRealization[]) {
    for (const r of rows) {
      const values = {
        id: r.id,
        forecastId: r.forecastId,
        status: r.status,
        windowStart: r.windowStart,
        windowEnd: r.windowEnd,
        rawReturnPct: r.rawReturnPct,
        benchmarkReturnPct: r.benchmarkReturnPct,
        abnormalReturnPct: r.abnormalReturnPct,
        betaUsed: r.betaUsed,
        outcomeClass: r.outcomeClass,
        quality: r.quality,
        failureReason: r.failureReason,
        resolvedAt: r.resolvedAt,
      };
      const existing = await this.db.select({ status: s.forecastRealizations.status }).from(s.forecastRealizations).where(eq(s.forecastRealizations.forecastId, r.forecastId));
      if (!existing.length) await this.db.insert(s.forecastRealizations).values(values).onConflictDoNothing();
      else if (existing[0]!.status === "pending" && r.status !== "pending") {
        await this.db.update(s.forecastRealizations).set(values).where(eq(s.forecastRealizations.forecastId, r.forecastId));
      }
    }
  }

  async realizationsFor(ids: string[]) {
    const out = new Map<string, ForecastRealization>();
    if (!ids.length) return out;
    const rows = await this.db.select().from(s.forecastRealizations).where(inArray(s.forecastRealizations.forecastId, ids));
    for (const r of rows) {
      out.set(r.forecastId, {
        id: r.id,
        forecastId: r.forecastId,
        status: r.status,
        windowStart: r.windowStart,
        windowEnd: r.windowEnd,
        rawReturnPct: r.rawReturnPct,
        benchmarkReturnPct: r.benchmarkReturnPct,
        abnormalReturnPct: r.abnormalReturnPct,
        betaUsed: r.betaUsed,
        outcomeClass: (r.outcomeClass as ForecastRealization["outcomeClass"]) ?? null,
        resolvedAt: r.resolvedAt,
        quality: (r.quality as ForecastRealization["quality"]) ?? null,
        failureReason: r.failureReason,
      });
    }
    return out;
  }

  async listEvents(limit: number) {
    const rows = await this.db.select({ payload: s.eventClusters.payload }).from(s.eventClusters).orderBy(desc(s.eventClusters.firstPublishedAt)).limit(limit);
    return rows.map((r) => r.payload as IntelligenceEvent);
  }

  async getEvent(id: string) {
    const rows = await this.db.select({ payload: s.eventClusters.payload }).from(s.eventClusters).where(eq(s.eventClusters.id, id)).limit(1);
    return (rows[0]?.payload as IntelligenceEvent) ?? null;
  }

  async startJob(kind: string, idempotencyKey: string, now: string) {
    const id = `job_${hashHex(`${kind}|${idempotencyKey}`)}`;
    const res = await this.db.insert(s.jobs).values({ id, kind, idempotencyKey, status: "running", startedAt: now }).onConflictDoNothing().returning({ id: s.jobs.id });
    return { id, acquired: res.length > 0 };
  }

  async finishJob(id: string, status: JobRecord["status"], detail: unknown, now: string) {
    await this.db.update(s.jobs).set({ status, detail: detail as object, finishedAt: now }).where(eq(s.jobs.id, id));
  }

  async listJobs(limit: number) {
    const rows = await this.db.select().from(s.jobs).orderBy(desc(s.jobs.startedAt)).limit(limit);
    return rows.map((r) => ({ id: r.id, kind: r.kind, idempotencyKey: r.idempotencyKey, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, detail: r.detail }));
  }

  async recordDeadLetters(rows: DeadLetter[]) {
    for (const d of rows) {
      await this.db.insert(s.auditEvents).values({ id: `dl_${hashHex(`${d.key}|${d.at}`)}`, at: d.at, actor: "pipeline", action: `dead_letter:${d.stage}`, detail: d }).onConflictDoNothing();
    }
  }

  async listDeadLetters(limit: number) {
    const rows = await this.db.select().from(s.auditEvents).orderBy(desc(s.auditEvents.at)).limit(limit * 3);
    return rows.filter((r) => r.action.startsWith("dead_letter:")).slice(0, limit).map((r) => r.detail as DeadLetter);
  }

  async listWatchlists(userId: string) {
    const ws = await this.db.select().from(s.watchlists).where(eq(s.watchlists.userId, userId));
    const out: WatchlistRecord[] = [];
    for (const w of ws) {
      const items = await this.db.select().from(s.watchlistItems).where(eq(s.watchlistItems.watchlistId, w.id));
      out.push({ ...w, tickers: items.map((i) => i.ticker) });
    }
    return out;
  }

  async upsertWatchlist(w: WatchlistRecord) {
    await this.db.insert(s.watchlists).values({ id: w.id, userId: w.userId, name: w.name, createdAt: w.createdAt }).onConflictDoUpdate({ target: s.watchlists.id, set: { name: w.name } });
    await this.db.delete(s.watchlistItems).where(eq(s.watchlistItems.watchlistId, w.id));
    if (w.tickers.length) await this.db.insert(s.watchlistItems).values(w.tickers.map((t) => ({ watchlistId: w.id, ticker: t })));
  }

  async deleteWatchlist(userId: string, id: string) {
    const res = await this.db.delete(s.watchlists).where(and(eq(s.watchlists.id, id), eq(s.watchlists.userId, userId))).returning({ id: s.watchlists.id });
    return res.length > 0;
  }

  async listAlerts(userId: string) {
    const rows = await this.db.select().from(s.userAlerts).where(eq(s.userAlerts.userId, userId));
    return rows.map((r) => ({ id: r.id, userId: r.userId, rule: r.rule, paused: r.paused, digest: r.digest, createdAt: r.createdAt }) satisfies AlertRecord);
  }

  async upsertAlert(a: AlertRecord) {
    await this.db.insert(s.userAlerts).values({ ...a, rule: a.rule as object }).onConflictDoUpdate({ target: s.userAlerts.id, set: { rule: a.rule as object, paused: a.paused, digest: a.digest } });
  }

  async deleteAlert(userId: string, id: string) {
    const res = await this.db.delete(s.userAlerts).where(and(eq(s.userAlerts.id, id), eq(s.userAlerts.userId, userId))).returning({ id: s.userAlerts.id });
    return res.length > 0;
  }
}
