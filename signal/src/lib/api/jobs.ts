import { isDemoMode } from "@/lib/config/env";
import { getRepository } from "@/lib/db/client";
import { recordReport } from "@/lib/data/liveService";
import { runLiveIngest, runResolveForecasts } from "@/lib/live/jobs";
import { json } from "@/lib/security/api";

/** Shared job execution for cron and admin routes. Demo mode never calls providers. */
export async function executeIngest(trigger: "cron" | "admin") {
  if (isDemoMode()) return json({ status: "skipped", reason: "DEMO_MODE is enabled; the demo world is deterministic and never ingests live data." });
  const report = await runLiveIngest({ now: new Date(), repo: getRepository(), trigger });
  recordReport(report);
  return json(report, { status: report.status === "failed" ? 502 : 200 });
}

export async function executeResolve() {
  if (isDemoMode()) return json({ status: "skipped", reason: "DEMO_MODE is enabled; demo realizations are computed from synthetic prices." });
  const r = await runResolveForecasts({ now: new Date(), repo: getRepository() });
  return json(r);
}
