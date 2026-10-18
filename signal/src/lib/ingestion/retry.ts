/** Bounded exponential backoff with jitter derived deterministically from the attempt key. */
import { hash32 } from "@/lib/quant/stats";

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  key?: string;
  retryable?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<{ value: T; attempts: number }> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseMs ?? 250;
  const max = opts.maxMs ?? 4000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const retryable = opts.retryable ?? ((e: unknown) => !(e instanceof NonRetryableError));
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return { value: await fn(i), attempts: i };
    } catch (e) {
      lastErr = e;
      if (i === attempts || !retryable(e)) break;
      const jitter = (hash32(`${opts.key ?? ""}|${i}`) % 100) / 100;
      await sleep(Math.min(max, base * 2 ** (i - 1) * (0.75 + 0.5 * jitter)));
    }
  }
  throw lastErr;
}
