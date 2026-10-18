# Providers and licensing

| Provider | Capability | Env | Display gate |
|---|---|---|---|
| SEC EDGAR | 8-K current filings feed, company/ticker directory | `SEC_USER_AGENT` (name + email) | Public data; ≤5 req/s token bucket; cached |
| FRED / ALFRED | CPI, core PCE, payrolls, unemployment, retail sales; vintages for revised priors | `FRED_API_KEY` | Public-domain agency series only; **never a consensus** |
| Financial Modeling Prep | latest stock news, EOD bars | `FMP_API_KEY` | `FMP_DISPLAY_LICENSE=confirmed`; consensus only with `FMP_CONSENSUS_LICENSED=true` |
| Massive (formerly Polygon) | news, daily aggregates | `MASSIVE_API_KEY` | `MASSIVE_DISPLAY_LICENSE=confirmed` (commercial display license) |
| Anthropic | optional extraction | `ANTHROPIC_API_KEY` | `LLM_PROCESSING_ALLOWED=true` only if vendor terms allow |
| Options | — | — | Not integrated; module shows "unavailable" |

Endpoints used (verified at build time where docs were reachable):
* SEC: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&output=atom`,
  `https://www.sec.gov/files/company_tickers.json` (fair access: ≤10 req/s per SEC guidance).
* FRED: `https://api.stlouisfed.org/fred/series/observations` with `realtime_start/realtime_end`.
* FMP: `/stable/news/stock-latest`, `/stable/historical-price-eod/full` (FMP docs returned HTTP 403 to
  automated fetches; payloads are schema-checked and mismatches surface as `schema` errors — verify
  field names against your plan before enabling).
* Massive: `/v2/reference/news`, `/v2/aggs/ticker/{t}/range/1/day/{from}/{to}`.

The HTTP client enforces an https host allowlist (SSRF guard), per-provider token buckets, timeouts,
bounded exponential backoff for 429/5xx only, a circuit breaker (5 consecutive failures → 60 s open),
API-key redaction in recorded errors, and p50/p95 latency tracking shown on Data Status.

Provider failures are recorded and shown; they never produce synthetic data in live mode.
See also the licensing matrix on the Data Status page (`src/lib/licensing/matrix.ts`).

### Source reliability priors
Regulator / statistical agency 0.97–0.98 · company press release 0.9 · newswire 0.8–0.85 ·
general news 0.65–0.72 · unverified social 0.2. Reliability feeds the event-quality indicator and
the "unverified" confirmation status that blocks numeric forecasts from single unreliable sources.
