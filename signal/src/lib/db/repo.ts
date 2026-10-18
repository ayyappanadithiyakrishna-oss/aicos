/**
 * Repository abstraction. Postgres (Drizzle) when DATABASE_URL is set; otherwise a process-local
 * memory store (ephemeral — fine for local live testing, documented as non-durable on serverless).
 * Both enforce insert-only forecasts: an existing snapshot is never overwritten.
 */
import type { ForecastRealization, ForecastSnapshot, IntelligenceEvent } from "@/lib/domain/types";
import type { DeadLetter } from "@/lib/ingestion/types";

export interface JobRecord {
  id: string;
  kind: string;
  idempotencyKey: string;
  status: "running" | "ok" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string | null;
  detail: unknown;
}

export interface WatchlistRecord {
  id: string;
  userId: string;
  name: string;
  tickers: string[];
  createdAt: string;
}

export interface AlertRecord {
  id: string;
  userId: string;
  rule: unknown;
  paused: boolean;
  digest: boolean;
  createdAt: string;
}

export class ImmutableForecastError extends Error {
  constructor(id: string) {
    super(`Forecast ${id} already exists with different content; snapshots are immutable`);
    this.name = "ImmutableForecastError";
  }
}

export interface Repository {
  readonly kind: "memory" | "postgres";
  seenKeys(keys: string[]): Promise<Set<string>>;
  recordRaw(rows: Array<{ key: string; provider: string; providerId: string; canonicalUrl: string; fetchedAt: string; publishedAt: string | null; status: string }>): Promise<void>;
  upsertEvents(events: IntelligenceEvent[]): Promise<void>;
  insertForecasts(forecasts: ForecastSnapshot[]): Promise<{ inserted: number; existing: number }>;
  latestForecasts(eventIds: string[]): Promise<Map<string, ForecastSnapshot>>;
  allForecasts(opts?: { ticker?: string; limit?: number }): Promise<ForecastSnapshot[]>;
  upsertRealizations(rows: ForecastRealization[]): Promise<void>;
  realizationsFor(forecastIds: string[]): Promise<Map<string, ForecastRealization>>;
  listEvents(limit: number): Promise<IntelligenceEvent[]>;
  getEvent(id: string): Promise<IntelligenceEvent | null>;
  startJob(kind: string, idempotencyKey: string, now: string): Promise<{ id: string; acquired: boolean }>;
  finishJob(id: string, status: JobRecord["status"], detail: unknown, now: string): Promise<void>;
  listJobs(limit: number): Promise<JobRecord[]>;
  recordDeadLetters(rows: DeadLetter[]): Promise<void>;
  listDeadLetters(limit: number): Promise<DeadLetter[]>;
  listWatchlists(userId: string): Promise<WatchlistRecord[]>;
  upsertWatchlist(w: WatchlistRecord): Promise<void>;
  deleteWatchlist(userId: string, id: string): Promise<boolean>;
  listAlerts(userId: string): Promise<AlertRecord[]>;
  upsertAlert(a: AlertRecord): Promise<void>;
  deleteAlert(userId: string, id: string): Promise<boolean>;
}

const key = (f: Pick<ForecastSnapshot, "eventId" | "securityId" | "horizon">) => `${f.eventId}|${f.securityId}|${f.horizon}`;

export class MemoryRepository implements Repository {
  readonly kind = "memory" as const;
  private raw = new Map<string, unknown>();
  private events = new Map<string, IntelligenceEvent>();
  private forecasts = new Map<string, ForecastSnapshot>();
  private realizations = new Map<string, ForecastRealization>();
  private jobs = new Map<string, JobRecord>();
  private dead: DeadLetter[] = [];
  private watch = new Map<string, WatchlistRecord>();
  private alerts = new Map<string, AlertRecord>();

  async seenKeys(keys: string[]) {
    return new Set(keys.filter((k) => this.raw.has(k)));
  }
  async recordRaw(rows: Parameters<Repository["recordRaw"]>[0]) {
    for (const r of rows) if (!this.raw.has(r.key)) this.raw.set(r.key, r);
  }
  async upsertEvents(events: IntelligenceEvent[]) {
    for (const e of events) this.events.set(e.id, structuredClone(e));
  }
  async insertForecasts(fs: ForecastSnapshot[]) {
    let inserted = 0;
    let existing = 0;
    for (const f of fs) {
      const prev = this.forecasts.get(f.id);
      if (prev) {
        if (JSON.stringify(prev) !== JSON.stringify(f)) throw new ImmutableForecastError(f.id);
        existing++;
        continue;
      }
      this.forecasts.set(f.id, Object.freeze(structuredClone(f)));
      inserted++;
    }
    return { inserted, existing };
  }
  async latestForecasts(eventIds: string[]) {
    const ids = new Set(eventIds);
    const out = new Map<string, ForecastSnapshot>();
    for (const f of this.forecasts.values()) {
      if (!ids.has(f.eventId)) continue;
      const k = key(f);
      const cur = out.get(k);
      if (!cur || f.revision > cur.revision) out.set(k, f);
    }
    return out;
  }
  async allForecasts(opts: { ticker?: string; limit?: number } = {}) {
    let xs = [...this.forecasts.values()];
    if (opts.ticker) xs = xs.filter((f) => f.ticker === opts.ticker);
    xs.sort((a, b) => b.forecastGeneratedAt.localeCompare(a.forecastGeneratedAt));
    return xs.slice(0, opts.limit ?? 500);
  }
  async upsertRealizations(rows: ForecastRealization[]) {
    for (const r of rows) {
      const prev = this.realizations.get(r.forecastId);
      if (prev && prev.status !== "pending") continue; // final records are never changed
      this.realizations.set(r.forecastId, r);
    }
  }
  async realizationsFor(ids: string[]) {
    const out = new Map<string, ForecastRealization>();
    for (const id of ids) {
      const r = this.realizations.get(id);
      if (r) out.set(id, r);
    }
    return out;
  }
  async listEvents(limit: number) {
    return [...this.events.values()].sort((a, b) => b.firstPublishedAt.localeCompare(a.firstPublishedAt)).slice(0, limit);
  }
  async getEvent(id: string) {
    return this.events.get(id) ?? null;
  }
  async startJob(kind: string, idempotencyKey: string, now: string) {
    const existing = [...this.jobs.values()].find((j) => j.kind === kind && j.idempotencyKey === idempotencyKey);
    if (existing) return { id: existing.id, acquired: false };
    const id = `job_${kind}_${idempotencyKey}`;
    this.jobs.set(id, { id, kind, idempotencyKey, status: "running", startedAt: now, finishedAt: null, detail: null });
    return { id, acquired: true };
  }
  async finishJob(id: string, status: JobRecord["status"], detail: unknown, now: string) {
    const j = this.jobs.get(id);
    if (j) this.jobs.set(id, { ...j, status, detail, finishedAt: now });
  }
  async listJobs(limit: number) {
    return [...this.jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  }
  async recordDeadLetters(rows: DeadLetter[]) {
    this.dead.push(...rows);
    if (this.dead.length > 500) this.dead.splice(0, this.dead.length - 500);
  }
  async listDeadLetters(limit: number) {
    return this.dead.slice(-limit).reverse();
  }
  async listWatchlists(userId: string) {
    return [...this.watch.values()].filter((w) => w.userId === userId);
  }
  async upsertWatchlist(w: WatchlistRecord) {
    this.watch.set(w.id, w);
  }
  async deleteWatchlist(userId: string, id: string) {
    const w = this.watch.get(id);
    if (!w || w.userId !== userId) return false;
    return this.watch.delete(id);
  }
  async listAlerts(userId: string) {
    return [...this.alerts.values()].filter((a) => a.userId === userId);
  }
  async upsertAlert(a: AlertRecord) {
    this.alerts.set(a.id, a);
  }
  async deleteAlert(userId: string, id: string) {
    const a = this.alerts.get(id);
    if (!a || a.userId !== userId) return false;
    return this.alerts.delete(id);
  }
}
