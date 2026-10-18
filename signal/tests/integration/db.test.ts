import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "@/lib/db/schema";
import { PgRepository } from "@/lib/db/pgRepo";
import { getDemoWorld } from "@/lib/demo/world";
import type { ForecastSnapshot } from "@/lib/domain/types";

let client: PGlite;
let repo: PgRepository;

beforeAll(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  repo = new PgRepository(db as never);
});

const pred = (o: Partial<Record<string, unknown>> = {}) => ({
  id: `p_${Math.random().toString(36).slice(2)}`,
  event_id: "ev",
  security_id: "s",
  horizon: "next_session",
  forecast_generated_at: "2026-10-14T18:32:00Z",
  as_of: "2026-10-14T18:32:00Z",
  central_move_pct: 1,
  interval_low_pct: -1,
  interval_high_pct: 2,
  prob_up: null,
  prob_down: null,
  prob_neutral: null,
  direction: "bullish",
  quality_tier: "evaluated",
  sample_size: 10,
  model_version: "m",
  revision: 1,
  snapshot: "{}",
  is_synthetic: true,
  ...o,
});

async function insertRaw(o: Partial<Record<string, unknown>>) {
  const r = pred(o);
  const cols = Object.keys(r);
  const vals = Object.values(r);
  await client.query(`insert into predictions (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`, vals as never[]);
  return r.id as string;
}

describe("database constraints", () => {
  it("accepts a coherent forecast", async () => {
    await expect(insertRaw({ revision: 1, event_id: "ok" })).resolves.toBeTruthy();
  });

  it("rejects probabilities that do not sum to 1", async () => {
    await expect(insertRaw({ event_id: "p1", quality_tier: "calibrated", prob_up: 0.5, prob_down: 0.4, prob_neutral: 0.3 })).rejects.toThrow(/pred_probabilities/);
  });

  it("rejects probabilities on an uncalibrated forecast", async () => {
    await expect(insertRaw({ event_id: "p2", quality_tier: "evaluated", prob_up: 0.5, prob_down: 0.3, prob_neutral: 0.2 })).rejects.toThrow(/calibrated_only/);
  });

  it("rejects an abstaining forecast with numbers", async () => {
    await expect(insertRaw({ event_id: "p3", quality_tier: "insufficient", direction: "insufficient" })).rejects.toThrow(/abstain/);
  });

  it("rejects invalid horizons and inverted intervals", async () => {
    await expect(insertRaw({ event_id: "p4", horizon: "2_weeks" })).rejects.toThrow();
    await expect(insertRaw({ event_id: "p5", interval_low_pct: 3, interval_high_pct: 1, central_move_pct: 2 })).rejects.toThrow(/interval_order/);
  });

  it("rejects look-ahead: baseline after as-of, as-of after generation", async () => {
    await expect(insertRaw({ event_id: "p6", baseline_price_time: "2026-10-14T19:00:00Z" })).rejects.toThrow(/baseline_before_asof/);
    await expect(insertRaw({ event_id: "p7", as_of: "2026-10-14T19:00:00Z" })).rejects.toThrow(/asof_before_generation/);
  });

  it("makes stored predictions immutable (UPDATE and DELETE rejected by trigger)", async () => {
    const id = await insertRaw({ event_id: "imm" });
    await expect(client.query("update predictions set central_move_pct = 9 where id = $1", [id])).rejects.toThrow(/immutable/);
    await expect(client.query("delete from predictions where id = $1", [id])).rejects.toThrow(/immutable/);
  });

  it("enforces unique (event, security, horizon, revision)", async () => {
    await insertRaw({ event_id: "dup", revision: 1 });
    await expect(insertRaw({ event_id: "dup", revision: 1 })).rejects.toThrow(/predictions_revision_uq/);
    await expect(insertRaw({ event_id: "dup", revision: 2 })).resolves.toBeTruthy();
  });

  it("macro consensus must match units and be licensed", async () => {
    const q = "insert into macro_releases (id, indicator, period, release_at, release_time_known, unit, actual, consensus, consensus_unit, consensus_licensed, source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)";
    await expect(client.query(q, ["m1", "CPI", "2026-09", "2026-10-14T12:30:00Z", true, "%", 3.4, 3.1, "%", true, "x"])).resolves.toBeTruthy();
    await expect(client.query(q, ["m2", "CPI", "2026-08", "2026-09-14T12:30:00Z", true, "%", 3.2, 310, "bp", true, "x"])).rejects.toThrow(/macro_consensus_units/);
    await expect(client.query(q, ["m3", "CPI", "2026-07", "2026-08-14T12:30:00Z", true, "%", 3.2, 3.1, "%", false, "x"])).rejects.toThrow(/macro_consensus_units/);
  });

  it("exposures must cite evidence", async () => {
    await client.query("insert into event_clusters (id, event_type, subtype, first_published_at, updated_at, severity, relevance, quality_score, confirmation_status, is_synthetic, payload) values ('e1','macro','macro.cpi','2026-10-14T12:30:00Z','2026-10-14T12:30:00Z','high',1,90,'official_release',true,'{}')");
    await expect(client.query("insert into event_exposures (event_id, security_id, relationship, directness, sign, mechanism, evidence_ids) values ('e1','s','direct','direct','positive','m','[]')")).rejects.toThrow(/exposure_has_evidence/);
  });
});

describe("PgRepository", () => {
  it("persists events and forecasts, reuses identical snapshots, and links revisions", async () => {
    const w = await getDemoWorld();
    const events = w.events.slice(0, 4);
    await repo.upsertEvents(events);
    const fs = events.flatMap((e) => e.forecasts);
    const first = await repo.insertForecasts(fs);
    expect(first.inserted).toBe(fs.length);
    const again = await repo.insertForecasts(fs);
    expect(again.inserted).toBe(0);
    const latest = await repo.latestForecasts(events.map((e) => e.id));
    expect(latest.size).toBe(fs.length);
    const stored = (await repo.getEvent(events[0]!.id))!;
    expect(stored.bottomLine).toBe(events[0]!.bottomLine);

    const orig = fs[0]!;
    const rev: ForecastSnapshot = { ...orig, id: `${orig.id}_r2`, revision: orig.revision + 1, supersedes: orig.id, forecastGeneratedAt: new Date(Date.parse(orig.forecastGeneratedAt) + 60000).toISOString(), asOf: new Date(Date.parse(orig.asOf) + 60000).toISOString() };
    await repo.insertForecasts([rev]);
    const after = await repo.latestForecasts([orig.eventId]);
    expect(after.get(`${orig.eventId}|${orig.securityId}|${orig.horizon}`)!.id).toBe(rev.id);
    const rows = await client.query<{ n: number }>("select count(*)::int as n from prediction_revisions where supersedes = $1", [orig.id]);
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("realizations move out of pending once and are then final", async () => {
    const w = await getDemoWorld();
    const f = w.events[0]!.forecasts[0]!;
    const base = { id: `rz_${f.id}`, forecastId: f.id, windowStart: null, windowEnd: null, benchmarkReturnPct: null, betaUsed: null, outcomeClass: null, resolvedAt: null, quality: null, failureReason: null };
    await repo.upsertRealizations([{ ...base, status: "pending", rawReturnPct: null, abnormalReturnPct: null }]);
    await repo.upsertRealizations([{ ...base, status: "resolved", rawReturnPct: 1.5, abnormalReturnPct: 1.2, outcomeClass: "up" }]);
    expect((await repo.realizationsFor([f.id])).get(f.id)!.status).toBe("resolved");
    await expect(client.query("update forecast_realizations set abnormal_return_pct = 5 where forecast_id = $1", [f.id])).rejects.toThrow(/final/);
  });

  it("jobs are idempotent per kind + key", async () => {
    const a = await repo.startJob("ingest", "cron:1", "2026-10-14T18:30:00Z");
    const b = await repo.startJob("ingest", "cron:1", "2026-10-14T18:31:00Z");
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(false);
    await repo.finishJob(a.id, "ok", { n: 1 }, "2026-10-14T18:32:00Z");
    expect((await repo.listJobs(5))[0]!.status).toBe("ok");
  });

  it("scopes watchlists to their owner", async () => {
    await repo.upsertWatchlist({ id: "w1", userId: "u1", name: "Mine", tickers: ["HLCN", "VRTA"], createdAt: "2026-10-14T00:00:00Z" });
    expect(await repo.listWatchlists("u2")).toHaveLength(0);
    expect((await repo.listWatchlists("u1"))[0]!.tickers.sort()).toEqual(["HLCN", "VRTA"]);
    expect(await repo.deleteWatchlist("u2", "w1")).toBe(false);
    expect(await repo.deleteWatchlist("u1", "w1")).toBe(true);
  });
});
