# Deploying to Vercel

The app is a standard Next.js project rooted at `signal/`.

1. Create a Vercel project with **Root Directory = `signal`** (framework auto-detected).
2. Environment variables (Production): `DEMO_MODE=true` for the public demo, or the live set from
   `.env.example`. Always set `CRON_SECRET` (≥16 chars) — cron routes refuse requests without it.
3. `vercel.json` declares two crons, each at most once per weekday (valid on Hobby):
   `/api/cron/ingest` 13:15 UTC and `/api/cron/resolve-forecasts` 21:30 UTC. Hobby timing precision is
   ±59 min. For near-real-time live data use Pro (per-minute cron) or an external scheduler.
4. Database (optional): add Neon via the Vercel Marketplace, then run migrations once:
   `DATABASE_URL=... npm run db:migrate`.
5. Smoke test: `/api/health` (mode), `/` (DEMO band visible in demo), `/status`.

```bash
cd signal && vercel link && vercel env add CRON_SECRET production && vercel deploy --prod
```

## Cost tiers (check current vendor pricing before committing)
| Tier | Components | Notes |
|---|---|---|
| Demo | Vercel Hobby, no keys | Fully functional synthetic demo; no data costs |
| Licensed pilot | Vercel Pro, Neon, SEC + FRED (free), one news/price vendor with display rights | Per-minute cron; vendor plan sets latency and quotas |
| Production | Pro/Enterprise, durable workflow service, licensed news + consensus + options, monitoring | Redistribution licenses usually dominate cost |
An authenticated Claude Code session is not an inference subscription: model-assisted extraction needs
its own API key and must be permitted by each content vendor's terms.
