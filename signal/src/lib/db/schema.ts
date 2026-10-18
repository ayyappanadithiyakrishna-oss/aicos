/**
 * PostgreSQL schema (Drizzle). UTC everywhere. Forecast snapshots are insert-only and protected by
 * a trigger (see drizzle/0001_integrity.sql); revisions are new rows linked via `supersedes`.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const horizonEnum = pgEnum("horizon", ["1h", "next_session", "5_sessions"]);
export const qualityTierEnum = pgEnum("quality_tier", ["calibrated", "evaluated", "research", "direction_only", "insufficient"]);
export const directionEnum = pgEnum("direction", ["bullish", "bearish", "no_edge", "mixed", "insufficient"]);
export const realizationStatusEnum = pgEnum("realization_status", ["pending", "resolved", "failed", "not_resolvable"]);
export const jobStatusEnum = pgEnum("job_status", ["running", "ok", "failed", "skipped"]);

export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  reliability: real("reliability").notNull(),
  homepage: text("homepage"),
  displayLicensed: boolean("display_licensed").notNull().default(false),
  permittedFields: jsonb("permitted_fields").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  retentionDays: integer("retention_days"),
}, (t) => [check("sources_reliability_range", sql`${t.reliability} >= 0 and ${t.reliability} <= 1`)]);

export const rawIngestRecords = pgTable("raw_ingest_records", {
  key: text("key").primaryKey(), // content hash — idempotency key
  provider: text("provider").notNull(),
  providerId: text("provider_id").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  fetchedAt: ts("fetched_at").notNull(),
  publishedAt: ts("published_at"),
  status: text("status").notNull(),
  payloadPolicy: text("payload_policy").notNull().default("metadata_only"),
}, (t) => [uniqueIndex("raw_provider_item_uq").on(t.provider, t.providerId), index("raw_fetched_idx").on(t.fetchedAt)]);

export const articles = pgTable("articles", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id),
  canonicalUrl: text("canonical_url").notNull(),
  url: text("url").notNull(),
  publisher: text("publisher").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt").notNull(),
  contentScope: text("content_scope").notNull(),
  publishedAt: ts("published_at").notNull(),
  publishedAtKnown: boolean("published_at_known").notNull(),
  ingestedAt: ts("ingested_at").notNull(),
  contentHash: text("content_hash").notNull(),
}, (t) => [uniqueIndex("articles_source_url_uq").on(t.sourceId, t.canonicalUrl), index("articles_published_idx").on(t.publishedAt)]);

export const securities = pgTable("securities", {
  id: text("id").primaryKey(),
  ticker: text("ticker").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  exchange: text("exchange").notNull(),
  currency: text("currency").notNull(),
  sector: text("sector").notNull(),
  cik: text("cik"),
  brandingRights: text("branding_rights").notNull().default("none"),
  isSynthetic: boolean("is_synthetic").notNull().default(false),
}, (t) => [index("securities_ticker_idx").on(t.ticker)]);

export const tickerHistory = pgTable("ticker_history", {
  securityId: text("security_id").notNull().references(() => securities.id),
  ticker: text("ticker").notNull(),
  validFrom: ts("valid_from").notNull(),
  validTo: ts("valid_to"),
}, (t) => [primaryKey({ columns: [t.securityId, t.validFrom] }), check("ticker_history_range", sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`)]);

export const eventClusters = pgTable("event_clusters", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  subtype: text("subtype").notNull(),
  firstPublishedAt: ts("first_published_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
  severity: text("severity").notNull(),
  relevance: doublePrecision("relevance").notNull(),
  qualityScore: integer("quality_score").notNull(),
  confirmationStatus: text("confirmation_status").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
  /** Full assembled event (bounded, entitled fields only). */
  payload: jsonb("payload").notNull(),
}, (t) => [index("events_published_idx").on(t.firstPublishedAt), index("events_relevance_idx").on(t.relevance), check("events_updated_after_first", sql`${t.updatedAt} >= ${t.firstPublishedAt}`)]);

export const eventArticles = pgTable("event_articles", {
  eventId: text("event_id").notNull().references(() => eventClusters.id),
  articleId: text("article_id").notNull(),
  isOriginal: boolean("is_original").notNull(),
}, (t) => [primaryKey({ columns: [t.eventId, t.articleId] })]);

export const eventEvidence = pgTable("event_evidence", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => eventClusters.id),
  factText: text("fact_text").notNull(),
  evidenceUrl: text("evidence_url").notNull(),
  kind: text("kind").notNull(),
});

export const eventExposures = pgTable("event_exposures", {
  eventId: text("event_id").notNull().references(() => eventClusters.id),
  securityId: text("security_id").notNull(),
  relationship: text("relationship").notNull(),
  directness: text("directness").notNull(),
  sign: text("sign").notNull(),
  mechanism: text("mechanism").notNull(),
  evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull(),
}, (t) => [primaryKey({ columns: [t.eventId, t.securityId] }), check("exposure_has_evidence", sql`jsonb_array_length(${t.evidenceIds}) > 0`)]);

export const pricesBars = pgTable("prices_bars", {
  securityId: text("security_id").notNull(),
  interval: text("interval").notNull(),
  t: ts("t").notNull(),
  o: doublePrecision("o").notNull(),
  h: doublePrecision("h").notNull(),
  l: doublePrecision("l").notNull(),
  c: doublePrecision("c").notNull(),
  v: doublePrecision("v").notNull(),
  source: text("source").notNull(),
  entitlement: text("entitlement").notNull(),
}, (t) => [primaryKey({ columns: [t.securityId, t.interval, t.t] }), check("bars_positive", sql`${t.l} > 0 and ${t.h} >= ${t.l}`)]);

export const corporateActions = pgTable("corporate_actions", {
  securityId: text("security_id").notNull(),
  effective: ts("effective").notNull(),
  kind: text("kind").notNull(),
  ratio: doublePrecision("ratio").notNull(),
}, (t) => [primaryKey({ columns: [t.securityId, t.effective, t.kind] }), check("ratio_positive", sql`${t.ratio} > 0`)]);

export const macroReleases = pgTable("macro_releases", {
  id: text("id").primaryKey(),
  indicator: text("indicator").notNull(),
  period: text("period").notNull(),
  releaseAt: ts("release_at").notNull(),
  releaseTimeKnown: boolean("release_time_known").notNull(),
  unit: text("unit").notNull(),
  actual: doublePrecision("actual"),
  consensus: doublePrecision("consensus"),
  consensusUnit: text("consensus_unit"),
  consensusSource: text("consensus_source"),
  consensusLicensed: boolean("consensus_licensed").notNull().default(false),
  source: text("source").notNull(),
}, (t) => [
  uniqueIndex("macro_indicator_period_uq").on(t.indicator, t.period),
  // A consensus value requires a matching unit and a licensed source; never a prior print.
  check("macro_consensus_units", sql`${t.consensus} is null or (${t.consensusUnit} = ${t.unit} and ${t.consensusLicensed})`),
]);

export const macroVintages = pgTable("macro_vintages", {
  indicator: text("indicator").notNull(),
  period: text("period").notNull(),
  vintageDate: ts("vintage_date").notNull(),
  value: doublePrecision("value").notNull(),
}, (t) => [primaryKey({ columns: [t.indicator, t.period, t.vintageDate] })]);

export const modelVersions = pgTable("model_versions", {
  version: text("version").primaryKey(),
  methodology: text("methodology").notNull(),
  trainingCutoff: ts("training_cutoff").notNull(),
  calibrationEnd: ts("calibration_end").notNull(),
  trainedAt: ts("trained_at").notNull(),
  calibration: jsonb("calibration").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
}, (t) => [check("model_cutoff_order", sql`${t.calibrationEnd} >= ${t.trainingCutoff}`)]);

export const quantFeatures = pgTable("quant_features", {
  forecastId: text("forecast_id").primaryKey(),
  asOf: ts("as_of").notNull(),
  features: jsonb("features").notNull(),
});

export const predictions = pgTable("predictions", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  securityId: text("security_id").notNull(),
  horizon: horizonEnum("horizon").notNull(),
  forecastGeneratedAt: ts("forecast_generated_at").notNull(),
  asOf: ts("as_of").notNull(),
  baselinePriceTime: ts("baseline_price_time"),
  baseMarketPrice: doublePrecision("base_market_price"),
  centralMovePct: doublePrecision("central_move_pct"),
  intervalLowPct: doublePrecision("interval_low_pct"),
  intervalHighPct: doublePrecision("interval_high_pct"),
  probUp: doublePrecision("prob_up"),
  probDown: doublePrecision("prob_down"),
  probNeutral: doublePrecision("prob_neutral"),
  direction: directionEnum("direction").notNull(),
  qualityTier: qualityTierEnum("quality_tier").notNull(),
  sampleSize: integer("sample_size").notNull(),
  modelVersion: text("model_version").notNull(),
  revision: integer("revision").notNull(),
  supersedes: text("supersedes"),
  snapshot: jsonb("snapshot").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
}, (t) => [
  index("predictions_event_idx").on(t.eventId),
  index("predictions_security_idx").on(t.securityId, t.forecastGeneratedAt),
  uniqueIndex("predictions_revision_uq").on(t.eventId, t.securityId, t.horizon, t.revision),
  check("pred_asof_before_generation", sql`${t.asOf} <= ${t.forecastGeneratedAt}`),
  check("pred_baseline_before_asof", sql`${t.baselinePriceTime} is null or ${t.baselinePriceTime} <= ${t.asOf}`),
  check("pred_interval_order", sql`${t.intervalLowPct} is null or ${t.intervalHighPct} is null or ${t.intervalLowPct} <= ${t.intervalHighPct}`),
  check("pred_interval_pair", sql`(${t.intervalLowPct} is null) = (${t.intervalHighPct} is null)`),
  check(
    "pred_probabilities",
    sql`(${t.probUp} is null and ${t.probDown} is null and ${t.probNeutral} is null) or (${t.probUp} between 0 and 1 and ${t.probDown} between 0 and 1 and ${t.probNeutral} between 0 and 1 and abs(${t.probUp} + ${t.probDown} + ${t.probNeutral} - 1) <= 0.000001)`,
  ),
  check("pred_probabilities_calibrated_only", sql`${t.probUp} is null or ${t.qualityTier} = 'calibrated'`),
  check("pred_abstain_has_no_numbers", sql`${t.qualityTier} not in ('insufficient', 'direction_only') or (${t.centralMovePct} is null and ${t.intervalLowPct} is null and ${t.probUp} is null)`),
  check("pred_revision_positive", sql`${t.revision} >= 1`),
]);

export const predictionRevisions = pgTable("prediction_revisions", {
  predictionId: text("prediction_id").notNull().references(() => predictions.id),
  supersedes: text("supersedes").notNull().references(() => predictions.id),
  reason: text("reason").notNull(),
  createdAt: ts("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.predictionId, t.supersedes] })]);

export const forecastRealizations = pgTable("forecast_realizations", {
  id: text("id").primaryKey(),
  forecastId: text("forecast_id").notNull().references(() => predictions.id),
  status: realizationStatusEnum("status").notNull(),
  windowStart: ts("window_start"),
  windowEnd: ts("window_end"),
  rawReturnPct: doublePrecision("raw_return_pct"),
  benchmarkReturnPct: doublePrecision("benchmark_return_pct"),
  abnormalReturnPct: doublePrecision("abnormal_return_pct"),
  betaUsed: doublePrecision("beta_used"),
  outcomeClass: text("outcome_class"),
  quality: text("quality"),
  failureReason: text("failure_reason"),
  resolvedAt: ts("resolved_at"),
}, (t) => [uniqueIndex("realization_forecast_uq").on(t.forecastId), check("realization_resolved_has_values", sql`${t.status} <> 'resolved' or ${t.rawReturnPct} is not null`)]);

export const watchlists = pgTable("watchlists", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull(),
}, (t) => [index("watchlists_user_idx").on(t.userId)]);

export const watchlistItems = pgTable("watchlist_items", {
  watchlistId: text("watchlist_id").notNull().references(() => watchlists.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
}, (t) => [primaryKey({ columns: [t.watchlistId, t.ticker] })]);

export const userAlerts = pgTable("user_alerts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  rule: jsonb("rule").notNull(),
  paused: boolean("paused").notNull().default(false),
  digest: boolean("digest").notNull().default(false),
  createdAt: ts("created_at").notNull(),
}, (t) => [index("alerts_user_idx").on(t.userId)]);

export const alertDeliveries = pgTable("alert_deliveries", {
  id: text("id").primaryKey(),
  alertId: text("alert_id").notNull().references(() => userAlerts.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull(),
  channel: text("channel").notNull(),
  status: text("status").notNull(),
  createdAt: ts("created_at").notNull(),
}, (t) => [uniqueIndex("alert_delivery_dedup_uq").on(t.alertId, t.eventId, t.channel)]);

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: jobStatusEnum("status").notNull(),
  startedAt: ts("started_at").notNull(),
  finishedAt: ts("finished_at"),
  detail: jsonb("detail"),
  lockedUntil: ts("locked_until"),
}, (t) => [uniqueIndex("jobs_idem_uq").on(t.kind, t.idempotencyKey), index("jobs_started_idx").on(t.startedAt)]);

export const providerHealth = pgTable("provider_health", {
  provider: text("provider").notNull(),
  recordedAt: ts("recorded_at").notNull(),
  status: text("status").notNull(),
  latencyP50Ms: integer("latency_p50_ms"),
  latencyP95Ms: integer("latency_p95_ms"),
  requests: integer("requests").notNull(),
  failures: integer("failures").notNull(),
  lastError: text("last_error"),
}, (t) => [primaryKey({ columns: [t.provider, t.recordedAt] })]);

export const rateLimitUsage = pgTable("rate_limit_usage", {
  provider: text("provider").notNull(),
  windowStart: ts("window_start").notNull(),
  requests: integer("requests").notNull(),
}, (t) => [primaryKey({ columns: [t.provider, t.windowStart] })]);

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  at: ts("at").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detail: jsonb("detail"),
}, (t) => [index("audit_at_idx").on(t.at)]);
