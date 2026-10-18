import "server-only";
/**
 * Server-side environment parsing. Secrets never leave this module except as booleans
 * ("configured") — nothing here is ever serialized to the client.
 */
import { z } from "zod";

const Env = z.object({
  DEMO_MODE: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  FMP_API_KEY: z.string().optional(),
  FMP_DISPLAY_LICENSE: z.string().optional(),
  FMP_CONSENSUS_LICENSED: z.string().optional(),
  MASSIVE_API_KEY: z.string().optional(),
  MASSIVE_DISPLAY_LICENSE: z.string().optional(),
  FRED_API_KEY: z.string().optional(),
  SEC_USER_AGENT: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_PROCESSING_ALLOWED: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  ADMIN_TOKEN: z.string().optional(),
  LIVE_REFRESH_SECONDS: z.string().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().optional(),
  MIN_METRIC_SAMPLE: z.string().optional(),
});

export type ServerEnv = z.infer<typeof Env>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return Env.parse(source);
}

/** DEMO is the default; live mode requires an explicit DEMO_MODE=false. */
export function isDemoMode(source: NodeJS.ProcessEnv = process.env): boolean {
  return (source.DEMO_MODE ?? "true").toLowerCase() !== "false";
}

export function cronSecretValid(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 16;
}

export function minMetricSample(source: NodeJS.ProcessEnv = process.env): number {
  const n = Number(source.MIN_METRIC_SAMPLE ?? 30);
  return Number.isFinite(n) && n >= 5 ? Math.floor(n) : 30;
}
