/**
 * Outbound HTTP for provider adapters: host allowlist (SSRF guard), per-provider token-bucket
 * rate limits, timeouts, bounded retries on 429/5xx, circuit breaker, latency/health metrics.
 * API keys are passed in query/header by adapters and are redacted from every recorded error.
 */
import { withRetry, NonRetryableError } from "@/lib/ingestion/retry";
import { quantile } from "@/lib/quant/stats";

export const ALLOWED_HOSTS = new Set([
  "www.sec.gov",
  "data.sec.gov",
  "efts.sec.gov",
  "api.stlouisfed.org",
  "financialmodelingprep.com",
  "api.massive.com",
  "api.polygon.io",
  "api.gdeltproject.org",
  "query1.finance.yahoo.com",
  "api.bls.gov",
  "www.nasdaqtrader.com",
  "search.cnbc.com",
  "www.federalreserve.gov",
]);

export type ProviderErrorKind = "auth" | "quota" | "rate_limited" | "upstream" | "schema" | "network" | "blocked" | "circuit_open";

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

interface Health {
  requests: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  latencies: number[];
  openedAt: number | null;
  tokens: number;
  refilledAt: number;
}

const health = new Map<string, Health>();

function h(provider: string): Health {
  let x = health.get(provider);
  if (!x) health.set(provider, (x = { requests: 0, failures: 0, consecutiveFailures: 0, lastSuccessAt: null, lastErrorAt: null, lastError: null, latencies: [], openedAt: null, tokens: 10, refilledAt: Date.now() }));
  return x;
}

export interface ProviderMetrics {
  requests: number;
  failures: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  circuit: "closed" | "open" | "half_open";
}

const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 60_000;

export function providerMetrics(provider: string): ProviderMetrics {
  const x = h(provider);
  const circuit = x.openedAt === null ? "closed" : Date.now() - x.openedAt > CIRCUIT_COOLDOWN_MS ? "half_open" : "open";
  return {
    requests: x.requests,
    failures: x.failures,
    lastSuccessAt: x.lastSuccessAt,
    lastErrorAt: x.lastErrorAt,
    lastError: x.lastError,
    latencyP50Ms: x.latencies.length ? Math.round(quantile(x.latencies, 0.5)) : null,
    latencyP95Ms: x.latencies.length ? Math.round(quantile(x.latencies, 0.95)) : null,
    circuit,
  };
}

export function resetProviderMetrics(): void {
  health.clear();
}

/** Token bucket: `ratePerSec` sustained, burst equal to the rate. Waits rather than exceeding. */
async function takeToken(provider: string, ratePerSec: number): Promise<void> {
  const x = h(provider);
  for (;;) {
    const now = Date.now();
    x.tokens = Math.min(Math.max(1, ratePerSec), x.tokens + ((now - x.refilledAt) / 1000) * ratePerSec);
    x.refilledAt = now;
    if (x.tokens >= 1) {
      x.tokens -= 1;
      return;
    }
    await new Promise((r) => setTimeout(r, Math.ceil(((1 - x.tokens) / ratePerSec) * 1000)));
  }
}

export function redact(s: string): string {
  return s.replace(/(apikey|api_key|apiKey|token|key)=([^&\s]+)/gi, "$1=REDACTED");
}

export interface FetchOptions {
  provider: string;
  ratePerSec: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
  attempts?: number;
  /** For tests: inject a fetch implementation. */
  fetchImpl?: typeof fetch;
  /** Next.js data-cache revalidation (seconds), when called from server components. */
  revalidate?: number;
}

export async function providerFetch(url: string, opts: FetchOptions): Promise<Response> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ProviderError(opts.provider, "blocked", "Invalid URL");
  }
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new ProviderError(opts.provider, "blocked", `Host not allowlisted: ${u.hostname}`);
  }
  const x = h(opts.provider);
  if (x.openedAt !== null && Date.now() - x.openedAt < CIRCUIT_COOLDOWN_MS) {
    throw new ProviderError(opts.provider, "circuit_open", "Circuit open after repeated failures");
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const run = async () => {
    await takeToken(opts.provider, opts.ratePerSec);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
    const t0 = Date.now();
    x.requests++;
    try {
      const init: RequestInit & { next?: { revalidate: number } } = { headers: opts.headers, signal: ctrl.signal, redirect: "error" };
      if (opts.revalidate !== undefined) init.next = { revalidate: opts.revalidate };
      const res = await doFetch(u.toString(), init);
      x.latencies.push(Date.now() - t0);
      if (x.latencies.length > 200) x.latencies.shift();
      if (res.status === 401 || res.status === 403) throw new NonRetryableErrorWith(new ProviderError(opts.provider, "auth", `HTTP ${res.status}: not authorized or not entitled`, res.status));
      if (res.status === 402) throw new NonRetryableErrorWith(new ProviderError(opts.provider, "quota", "HTTP 402: plan quota or entitlement exhausted", 402));
      if (res.status === 429) throw new ProviderError(opts.provider, "rate_limited", "HTTP 429: rate limited", 429);
      if (res.status >= 500) throw new ProviderError(opts.provider, "upstream", `HTTP ${res.status}`, res.status);
      if (!res.ok) throw new NonRetryableErrorWith(new ProviderError(opts.provider, "upstream", `HTTP ${res.status}`, res.status));
      return res;
    } catch (e) {
      if (e instanceof NonRetryableErrorWith || e instanceof ProviderError) throw e;
      throw new ProviderError(opts.provider, "network", redact(String(e instanceof Error ? e.message : e)));
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const { value } = await withRetry(run, { attempts: opts.attempts ?? 3, baseMs: 400, key: `${opts.provider}|${u.pathname}` });
    x.consecutiveFailures = 0;
    x.openedAt = null;
    x.lastSuccessAt = new Date().toISOString();
    return value;
  } catch (e) {
    const err = e instanceof NonRetryableErrorWith ? e.inner : e instanceof ProviderError ? e : new ProviderError(opts.provider, "network", redact(String(e)));
    x.failures++;
    x.consecutiveFailures++;
    x.lastErrorAt = new Date().toISOString();
    x.lastError = redact(`${err.kind}: ${err.message}`);
    if (x.consecutiveFailures >= CIRCUIT_THRESHOLD) x.openedAt = Date.now();
    throw err;
  }
}

class NonRetryableErrorWith extends NonRetryableError {
  constructor(readonly inner: ProviderError) {
    super(inner.message);
  }
}

export async function providerJson<T = unknown>(url: string, opts: FetchOptions): Promise<T> {
  const res = await providerFetch(url, opts);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(opts.provider, "schema", "Response was not valid JSON");
  }
}
