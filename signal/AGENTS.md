<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SIGNAL conventions
- Numbers shown to users come only from sourced facts or `src/lib/quant`; prose never contains numbers.
- Demo and live paths are separate (`src/lib/data/service.ts`); never return synthetic data in live mode.
- Forecast snapshots are immutable; changes create a new revision with `supersedes`.
- Every exposure must cite evidence; unverifiable tickers are quarantined, not shown.
- Run `npm run verify` before shipping.
