import { isDemoMode } from "@/lib/config/env";
import { json } from "@/lib/security/api";

/** Liveness + mode only. No secrets, no provider calls. */
export async function GET() {
  return json({ ok: true, mode: isDemoMode() ? "demo" : "live", time: new Date().toISOString(), version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local" });
}
