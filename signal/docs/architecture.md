# SIGNAL — architecture

SIGNAL turns financial headlines, disclosures and macro releases into source-grounded explanations of
the probable transmission mechanism, exposed securities, a statistically grounded reaction estimate
(or an explicit abstention), and a frozen forecast that is later checked against realized returns.

```
LICENSED INPUT → VERIFIED EVENT → EXPLAINABLE TRANSMISSION → SUPPORTED EXPOSURE
  → STATISTICAL FORECAST (OR ABSTENTION) → VISIBLE SOURCE / UNCERTAINTY
  → FROZEN FORECAST → REALIZED-RETURN EVALUATION
```

## Runtime layout

| Layer | Path | Notes |
|---|---|---|
| Pages (App Router, RSC) | `src/app/(product)/*` | ISR (`revalidate = 60`); demo event/ticker pages prerendered via `generateStaticParams` |
| API route handlers | `src/app/api/*` | Zod-validated queries/bodies, `no-store` or short CDN cache |
| Data service | `src/lib/data/service.ts` | Mode dispatcher → `demoService.ts` or `liveService.ts` (never both) |
| Pipeline | `src/lib/ingestion/pipeline.ts` | fetch → validate source/licence → canonicalize/dedupe → language/symbols → cluster → extract → evidence check → mechanisms → exposure → score → explain → editorial → rank |
| Analysis | `src/lib/analysis/*` | clustering, extraction contract (Zod), evidence checks, mechanism templates, ranking, quality, contradictions |
| Quant | `src/lib/quant/*` | priors, conformal intervals, isotonic calibration, forecast gating/validation, resolver, scorecard, options, priced-in |
| Calendar | `src/lib/calendar/*` | NYSE holidays/early closes/unscheduled closures, sessions, horizon windows |
| Providers | `src/lib/providers/*` | hardened HTTP client + SEC, FRED, FMP, Massive adapters |
| Live jobs | `src/lib/live/*` | registry, live security master, price store, ingest + resolve jobs |
| Persistence | `src/lib/db/*`, `drizzle/` | Drizzle schema, migrations with integrity triggers, memory + Postgres repositories |
| Demo world | `src/lib/demo/*` | synthetic universe, DGP, articles, world assembly (trains + evaluates the real model) |

## Modes

* **Demo (default)** — a deterministic synthetic market (≈1,450 historical events, 36 fictional
  securities, daily + 30-minute bars) is generated in-process. The *real* model is trained and
  walk-forward evaluated on reactions measured from those bars, then the *real* pipeline processes 34
  synthetic articles into 26 events. Every object is flagged synthetic and the UI carries a DEMO band.
* **Live (`DEMO_MODE=false`)** — providers are selected by capability from the registry. Unlicensed
  vendor content is dropped at the source-validation stage. No model trained on licensed point-in-time
  history ships with this build, so live forecasts are direction-only or abstain until one is trained.

## Background work

Vercel functions are not long-running workers. Ingestion and resolution are bounded, idempotent
batches (`jobs` table + 5-minute idempotency slot) triggered by authenticated Vercel Cron
(`/api/cron/ingest`, `/api/cron/resolve-forecasts`) or `POST /api/admin/ingest`. Without a database,
live mode refreshes on demand at most every `LIVE_REFRESH_SECONDS`. Hobby-plan cron is daily, so
near-real-time ingestion needs Pro (per-minute cron) or an external durable scheduler (Inngest,
Trigger.dev) calling the same job functions.

## Key decisions

* Next.js 16.3 (App Router, Turbopack), React 19.3, TypeScript strict + `noUncheckedIndexedAccess`.
* Tailwind v4 tokens; Radix primitives (dialog/popover); `cmdk` palette; `lightweight-charts` 5.
* Drizzle ORM with Neon serverless HTTP driver in production and PGlite in integration tests.
* Deterministic code authors every number. The optional LLM extractor is schema- and evidence-checked
  and can only propose facts/hypotheses; tickers always come from the security master.
