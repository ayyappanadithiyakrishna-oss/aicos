# Implementation checklist

| Area | Status |
|---|---|
| Feed: insight-first cards, impact rail, filters, search, ranking, cursor pagination, keyboard nav | Done |
| Event dossier: facts+evidence, mechanism graph, exposures × horizons, priced-in, checks, contradictions, analogs, timeline, who-said-what, quality, quarantine | Done |
| Market Pulse: observed vs hypothesis, sector leadership, breadth, cross-asset, volume anomalies | Done (no causal waterfall by design) |
| Impact Map (SVG DAG, hover/focus evidence, mobile list fallback) | Done |
| Ticker cockpit: chart w/ event markers, history, relationships, scenario sensitivity, attention | Done |
| Macro Radar (surprise rules), Earnings & Filings, Catalyst Calendar | Done |
| Forecast Lab (immutable archive, revisions) and Model Scorecard (OOS vs in-sample, baselines) | Done |
| Watchlists, in-app alerts (dedup/throttle/pause/digest), saved research | Done (browser-local; no identity provider) |
| Data Status: providers, latency, pipeline stages, model calibration, jobs, licensing matrix | Done |
| Live adapters: SEC, FRED, FMP, Massive; registry; jobs; cron/admin auth | Done (not exercised against paid APIs) |
| Postgres schema, migrations, constraints, triggers, repository | Done (tested on PGlite) |
| Authentication | Not configured — account endpoints return 401 |
| Options-implied module | License-blocked (math implemented and tested) |
| Trained live model | Blocked on licensed point-in-time history |
| Email/push alerts | Not implemented (in-app only) |
