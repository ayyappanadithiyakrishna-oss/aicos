# Operating guide

## Local
```bash
npm install
cp .env.example .env.local    # optional; demo mode needs nothing
npm run dev                   # http://localhost:3000
```

## Verify
```bash
npm run typecheck && npm run lint && npm test   # unit + integration (PGlite Postgres)
npm run build && npx playwright install chromium && npm run test:e2e
```

## Going live
1. Set `DEMO_MODE=false` and at least one provider (`SEC_USER_AGENT` is free and public).
2. Optional: `DATABASE_URL` (Neon) → `npm run db:migrate`. Without it, state is per instance.
3. Set `CRON_SECRET` (≥16 random chars) and `ADMIN_TOKEN`; trigger a first run:
   `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://<host>/api/admin/ingest`
4. Check **Data Status** for provider health, latency, license blocks, dead letters, quarantined symbols.

## Replays and failures
* Per-cluster failures are captured as dead letters (Data Status / `audit_events`) and do not abort the
  batch. Re-running ingest is idempotent: events keep stable IDs (keyed on the earliest report) and
  unchanged forecasts are reused; changed inputs create a new linked revision.
* A 5-minute idempotency slot prevents duplicate cron runs; `POST /api/admin/ingest` uses its own slot.

## Model
The demo model is trained on synthetic history at startup. A live model must be trained on licensed
point-in-time history (bars, actions, vintages), evaluated walk-forward, and deployed with its version;
until then live forecasts abstain or give direction only and probabilities stay disabled.
