CREATE TYPE "public"."direction" AS ENUM('bullish', 'bearish', 'no_edge', 'mixed', 'insufficient');--> statement-breakpoint
CREATE TYPE "public"."horizon" AS ENUM('1h', 'next_session', '5_sessions');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'ok', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."quality_tier" AS ENUM('calibrated', 'evaluated', 'research', 'direction_only', 'insufficient');--> statement-breakpoint
CREATE TYPE "public"."realization_status" AS ENUM('pending', 'resolved', 'failed', 'not_resolvable');--> statement-breakpoint
CREATE TABLE "alert_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"alert_id" text NOT NULL,
	"event_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"canonical_url" text NOT NULL,
	"url" text NOT NULL,
	"publisher" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"content_scope" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_at_known" boolean NOT NULL,
	"ingested_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"security_id" text NOT NULL,
	"effective" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"ratio" double precision NOT NULL,
	CONSTRAINT "corporate_actions_security_id_effective_kind_pk" PRIMARY KEY("security_id","effective","kind"),
	CONSTRAINT "ratio_positive" CHECK ("corporate_actions"."ratio" > 0)
);
--> statement-breakpoint
CREATE TABLE "event_articles" (
	"event_id" text NOT NULL,
	"article_id" text NOT NULL,
	"is_original" boolean NOT NULL,
	CONSTRAINT "event_articles_event_id_article_id_pk" PRIMARY KEY("event_id","article_id")
);
--> statement-breakpoint
CREATE TABLE "event_clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"subtype" text NOT NULL,
	"first_published_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"severity" text NOT NULL,
	"relevance" double precision NOT NULL,
	"quality_score" integer NOT NULL,
	"confirmation_status" text NOT NULL,
	"is_synthetic" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "events_updated_after_first" CHECK ("event_clusters"."updated_at" >= "event_clusters"."first_published_at")
);
--> statement-breakpoint
CREATE TABLE "event_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"fact_text" text NOT NULL,
	"evidence_url" text NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_exposures" (
	"event_id" text NOT NULL,
	"security_id" text NOT NULL,
	"relationship" text NOT NULL,
	"directness" text NOT NULL,
	"sign" text NOT NULL,
	"mechanism" text NOT NULL,
	"evidence_ids" jsonb NOT NULL,
	CONSTRAINT "event_exposures_event_id_security_id_pk" PRIMARY KEY("event_id","security_id"),
	CONSTRAINT "exposure_has_evidence" CHECK (jsonb_array_length("event_exposures"."evidence_ids") > 0)
);
--> statement-breakpoint
CREATE TABLE "forecast_realizations" (
	"id" text PRIMARY KEY NOT NULL,
	"forecast_id" text NOT NULL,
	"status" realization_status NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"raw_return_pct" double precision,
	"benchmark_return_pct" double precision,
	"abnormal_return_pct" double precision,
	"beta_used" double precision,
	"outcome_class" text,
	"quality" text,
	"failure_reason" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "realization_resolved_has_values" CHECK ("forecast_realizations"."status" <> 'resolved' or "forecast_realizations"."raw_return_pct" is not null)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "job_status" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"detail" jsonb,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "macro_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"indicator" text NOT NULL,
	"period" text NOT NULL,
	"release_at" timestamp with time zone NOT NULL,
	"release_time_known" boolean NOT NULL,
	"unit" text NOT NULL,
	"actual" double precision,
	"consensus" double precision,
	"consensus_unit" text,
	"consensus_source" text,
	"consensus_licensed" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "macro_consensus_units" CHECK ("macro_releases"."consensus" is null or ("macro_releases"."consensus_unit" = "macro_releases"."unit" and "macro_releases"."consensus_licensed"))
);
--> statement-breakpoint
CREATE TABLE "macro_vintages" (
	"indicator" text NOT NULL,
	"period" text NOT NULL,
	"vintage_date" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	CONSTRAINT "macro_vintages_indicator_period_vintage_date_pk" PRIMARY KEY("indicator","period","vintage_date")
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"version" text PRIMARY KEY NOT NULL,
	"methodology" text NOT NULL,
	"training_cutoff" timestamp with time zone NOT NULL,
	"calibration_end" timestamp with time zone NOT NULL,
	"trained_at" timestamp with time zone NOT NULL,
	"calibration" jsonb NOT NULL,
	"is_synthetic" boolean NOT NULL,
	CONSTRAINT "model_cutoff_order" CHECK ("model_versions"."calibration_end" >= "model_versions"."training_cutoff")
);
--> statement-breakpoint
CREATE TABLE "prediction_revisions" (
	"prediction_id" text NOT NULL,
	"supersedes" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prediction_revisions_prediction_id_supersedes_pk" PRIMARY KEY("prediction_id","supersedes")
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"security_id" text NOT NULL,
	"horizon" "horizon" NOT NULL,
	"forecast_generated_at" timestamp with time zone NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"baseline_price_time" timestamp with time zone,
	"base_market_price" double precision,
	"central_move_pct" double precision,
	"interval_low_pct" double precision,
	"interval_high_pct" double precision,
	"prob_up" double precision,
	"prob_down" double precision,
	"prob_neutral" double precision,
	"direction" "direction" NOT NULL,
	"quality_tier" "quality_tier" NOT NULL,
	"sample_size" integer NOT NULL,
	"model_version" text NOT NULL,
	"revision" integer NOT NULL,
	"supersedes" text,
	"snapshot" jsonb NOT NULL,
	"is_synthetic" boolean NOT NULL,
	CONSTRAINT "pred_asof_before_generation" CHECK ("predictions"."as_of" <= "predictions"."forecast_generated_at"),
	CONSTRAINT "pred_baseline_before_asof" CHECK ("predictions"."baseline_price_time" is null or "predictions"."baseline_price_time" <= "predictions"."as_of"),
	CONSTRAINT "pred_interval_order" CHECK ("predictions"."interval_low_pct" is null or "predictions"."interval_high_pct" is null or "predictions"."interval_low_pct" <= "predictions"."interval_high_pct"),
	CONSTRAINT "pred_interval_pair" CHECK (("predictions"."interval_low_pct" is null) = ("predictions"."interval_high_pct" is null)),
	CONSTRAINT "pred_probabilities" CHECK (("predictions"."prob_up" is null and "predictions"."prob_down" is null and "predictions"."prob_neutral" is null) or ("predictions"."prob_up" between 0 and 1 and "predictions"."prob_down" between 0 and 1 and "predictions"."prob_neutral" between 0 and 1 and abs("predictions"."prob_up" + "predictions"."prob_down" + "predictions"."prob_neutral" - 1) <= 0.000001)),
	CONSTRAINT "pred_probabilities_calibrated_only" CHECK ("predictions"."prob_up" is null or "predictions"."quality_tier" = 'calibrated'),
	CONSTRAINT "pred_abstain_has_no_numbers" CHECK ("predictions"."quality_tier" not in ('insufficient', 'direction_only') or ("predictions"."central_move_pct" is null and "predictions"."interval_low_pct" is null and "predictions"."prob_up" is null)),
	CONSTRAINT "pred_revision_positive" CHECK ("predictions"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prices_bars" (
	"security_id" text NOT NULL,
	"interval" text NOT NULL,
	"t" timestamp with time zone NOT NULL,
	"o" double precision NOT NULL,
	"h" double precision NOT NULL,
	"l" double precision NOT NULL,
	"c" double precision NOT NULL,
	"v" double precision NOT NULL,
	"source" text NOT NULL,
	"entitlement" text NOT NULL,
	CONSTRAINT "prices_bars_security_id_interval_t_pk" PRIMARY KEY("security_id","interval","t"),
	CONSTRAINT "bars_positive" CHECK ("prices_bars"."l" > 0 and "prices_bars"."h" >= "prices_bars"."l")
);
--> statement-breakpoint
CREATE TABLE "provider_health" (
	"provider" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"latency_p50_ms" integer,
	"latency_p95_ms" integer,
	"requests" integer NOT NULL,
	"failures" integer NOT NULL,
	"last_error" text,
	CONSTRAINT "provider_health_provider_recorded_at_pk" PRIMARY KEY("provider","recorded_at")
);
--> statement-breakpoint
CREATE TABLE "quant_features" (
	"forecast_id" text PRIMARY KEY NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"features" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_usage" (
	"provider" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"requests" integer NOT NULL,
	CONSTRAINT "rate_limit_usage_provider_window_start_pk" PRIMARY KEY("provider","window_start")
);
--> statement-breakpoint
CREATE TABLE "raw_ingest_records" (
	"key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_id" text NOT NULL,
	"canonical_url" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"status" text NOT NULL,
	"payload_policy" text DEFAULT 'metadata_only' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"exchange" text NOT NULL,
	"currency" text NOT NULL,
	"sector" text NOT NULL,
	"cik" text,
	"branding_rights" text DEFAULT 'none' NOT NULL,
	"is_synthetic" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"reliability" real NOT NULL,
	"homepage" text,
	"display_licensed" boolean DEFAULT false NOT NULL,
	"permitted_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retention_days" integer,
	CONSTRAINT "sources_reliability_range" CHECK ("sources"."reliability" >= 0 and "sources"."reliability" <= 1)
);
--> statement-breakpoint
CREATE TABLE "ticker_history" (
	"security_id" text NOT NULL,
	"ticker" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	CONSTRAINT "ticker_history_security_id_valid_from_pk" PRIMARY KEY("security_id","valid_from"),
	CONSTRAINT "ticker_history_range" CHECK ("ticker_history"."valid_to" is null or "ticker_history"."valid_to" > "ticker_history"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "user_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"rule" jsonb NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"digest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"watchlist_id" text NOT NULL,
	"ticker" text NOT NULL,
	CONSTRAINT "watchlist_items_watchlist_id_ticker_pk" PRIMARY KEY("watchlist_id","ticker")
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_alert_id_user_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."user_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_articles" ADD CONSTRAINT "event_articles_event_id_event_clusters_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_evidence" ADD CONSTRAINT "event_evidence_event_id_event_clusters_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_exposures" ADD CONSTRAINT "event_exposures_event_id_event_clusters_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_realizations" ADD CONSTRAINT "forecast_realizations_forecast_id_predictions_id_fk" FOREIGN KEY ("forecast_id") REFERENCES "public"."predictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_revisions" ADD CONSTRAINT "prediction_revisions_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_revisions" ADD CONSTRAINT "prediction_revisions_supersedes_predictions_id_fk" FOREIGN KEY ("supersedes") REFERENCES "public"."predictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticker_history" ADD CONSTRAINT "ticker_history_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_delivery_dedup_uq" ON "alert_deliveries" USING btree ("alert_id","event_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_source_url_uq" ON "articles" USING btree ("source_id","canonical_url");--> statement-breakpoint
CREATE INDEX "articles_published_idx" ON "articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "events_published_idx" ON "event_clusters" USING btree ("first_published_at");--> statement-breakpoint
CREATE INDEX "events_relevance_idx" ON "event_clusters" USING btree ("relevance");--> statement-breakpoint
CREATE UNIQUE INDEX "realization_forecast_uq" ON "forecast_realizations" USING btree ("forecast_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idem_uq" ON "jobs" USING btree ("kind","idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_started_idx" ON "jobs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "macro_indicator_period_uq" ON "macro_releases" USING btree ("indicator","period");--> statement-breakpoint
CREATE INDEX "predictions_event_idx" ON "predictions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "predictions_security_idx" ON "predictions" USING btree ("security_id","forecast_generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "predictions_revision_uq" ON "predictions" USING btree ("event_id","security_id","horizon","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_provider_item_uq" ON "raw_ingest_records" USING btree ("provider","provider_id");--> statement-breakpoint
CREATE INDEX "raw_fetched_idx" ON "raw_ingest_records" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "securities_ticker_idx" ON "securities" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "alerts_user_idx" ON "user_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "watchlists_user_idx" ON "watchlists" USING btree ("user_id");