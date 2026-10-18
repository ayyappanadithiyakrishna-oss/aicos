# SIGNAL — market impact intelligence

SIGNAL turns financial headlines, corporate disclosures and macro releases into short, source-grounded
explanations: **what happened, why it matters, who is exposed, how much of a move a calibrated model
expects (or why it abstains), over what horizon, and what would invalidate the view** — with every
forecast frozen at publication and later checked against realized returns.

It is informational research, not investment advice. It never places or suggests orders.

> **Runs in DEMO mode by default.** Without provider credentials the app serves a deterministic synthetic
> world — fictional companies, releases and prices, labelled DEMO everywhere. The real pipeline and model
> run on it end to end. Live integrations switch on with credentials and `DEMO_MODE=false`; demo and live
> data never mix.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

## What's inside

| View | What it does |
|---|---|
| Intelligence Feed | Ranked insight cards: bottom line, verified facts, transmission chain, impact rail with uncertainty bars, priced-in, echo index, contradictions |
| Event Dossier | Facts + evidence, mechanism graph, exposures × horizons, forecast checks, scenarios, analogs, timeline, who-said-what, event quality |
| Market Pulse | Observed moves vs. hypothesis links; sector leadership, breadth, cross-asset, volume anomalies |
| Impact Map | Event → macro → channels → assets graph with evidence, sign, lag and confidence on every edge |
| Ticker Intelligence | Chart with events at publication times, prediction-vs-outcome history, documented relationships, exploratory sensitivities |
| Macro Radar · Earnings & Filings · Catalyst Calendar | Surprise only from licensed consensus in matching units; 8-K item mapping; unconfirmed dates flagged |
| Forecast Lab · Model Scorecard | Immutable forecast archive with revisions; OOS metrics, baselines, calibration, insufficient-sample rules |
| Watchlists · Alerts · Saved | Browser-local; alerts dedupe by event cluster, throttle, pause, digest |
| Data Status | Provider health and latency, pipeline stages, model calibration, jobs, licensing matrix |

## Tests

```bash
npm run typecheck && npm run lint
npm test                       # 136 unit + integration tests (incl. Postgres via PGlite)
npm run build && npx playwright install chromium && npm run test:e2e   # 109 E2E at 1440/1024/768/390/320 + axe
```

## Docs
[architecture](docs/architecture.md) · [quant methodology](docs/quant-methodology.md) ·
[providers & licensing](docs/providers.md) · [security](docs/security.md) ·
[operating guide](docs/operating-guide.md) · [deploy to Vercel](docs/deploy-vercel.md) ·
[implementation checklist](docs/implementation-checklist.md)
