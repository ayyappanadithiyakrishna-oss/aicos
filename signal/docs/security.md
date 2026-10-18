# Security

* **Secrets** are read only in server modules (`src/lib/config/env.ts` uses `server-only`); nothing is
  serialized to the client. `.env.example` holds placeholders only. Errors redact `apikey|token|key`.
* **Headers**: CSP (`default-src 'self'`, no third-party origins, `frame-ancestors 'none'`,
  `object-src 'none'`), HSTS, `X-Frame-Options: DENY`, `nosniff`, strict referrer, permissions policy.
  Inline scripts are allowed for Next hydration and the no-flash theme script (nonce-based CSP is the
  upgrade path; it requires fully dynamic rendering).
* **Cron/admin**: `Authorization: Bearer` compared in constant time; secrets < 16 chars are refused.
  Admin ingest accepts no URLs or payloads (no arbitrary crawling).
* **Outbound requests**: https-only host allowlist, no redirects, timeouts, rate limits, circuit breaker.
* **Untrusted content**: markup/control/zero-width characters stripped; instruction-like text flagged
  and ignored; URLs rendered only if http(s) with a real host and no credentials; external links use
  `rel="noopener noreferrer nofollow"`; LLM output must satisfy a strict Zod schema and pass evidence checks.
* **Writes**: account endpoints require a session (none configured → 401) and same-origin `Origin`
  (CSRF defence in depth); bodies capped at 16 KB and Zod-validated; watchlists/alerts scoped by user id.
* **Database**: insert-only forecasts enforced by trigger; realizations final once resolved;
  append-only audit trail; CHECK constraints mirror the forecast validator.
