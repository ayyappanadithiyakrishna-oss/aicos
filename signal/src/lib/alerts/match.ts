/**
 * In-app alert matching: real rules, deduplication by (rule, event cluster), per-rule hourly
 * throttle, pause and digest. Syndicated duplicates never re-fire because events are clusters.
 */
import type { Severity } from "@/lib/domain/types";

export type AlertKind = "watchlist_material" | "ticker_any" | "filing" | "second_order" | "forecast_invalidation" | "quality_change";

export interface AlertRule {
  id: string;
  kind: AlertKind;
  label: string;
  tickers: string[];
  minSeverity: Severity;
  minQuality: number;
  paused: boolean;
  digest: boolean;
  maxPerHour: number;
  createdAt: string;
}

export interface AlertDelivery {
  id: string;
  ruleId: string;
  eventId: string;
  at: string;
  title: string;
  reason: string;
  read: boolean;
  status: "delivered" | "throttled" | "digested";
}

export interface AlertableEvent {
  id: string;
  firstPublishedAt: string;
  severity: Severity;
  quality: number;
  bottomLine: string;
  tags: string[];
  exposures: Array<{ ticker: string; directness: "direct" | "second_order"; forecasts: Partial<Record<string, { realized: { ar: number | null; status: string } | null; central: number | null; lo: number | null; hi: number | null }>> }>;
}

const SEV: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

function matchReason(rule: AlertRule, e: AlertableEvent): string | null {
  if (SEV[e.severity] < SEV[rule.minSeverity] || e.quality < rule.minQuality) return null;
  const tickers = new Set(rule.tickers.map((t) => t.toUpperCase()));
  const hits = e.exposures.filter((x) => tickers.has(x.ticker));
  switch (rule.kind) {
    case "watchlist_material":
    case "ticker_any":
      return hits.length ? `Involves ${hits.map((h) => h.ticker).join(", ")}` : null;
    case "filing":
      return e.tags.includes("filing") && hits.length ? `New filing for ${hits.map((h) => h.ticker).join(", ")}` : null;
    case "second_order": {
      const so = hits.filter((h) => h.directness === "second_order");
      return so.length ? `New second-order exposure: ${so.map((h) => h.ticker).join(", ")}` : null;
    }
    case "forecast_invalidation": {
      for (const h of hits) {
        const f = h.forecasts["next_session"];
        const ar = f?.realized?.ar;
        if (f && ar !== null && ar !== undefined && f.lo !== null && f.hi !== null && (ar < f.lo || ar > f.hi)) return `${h.ticker} realized move fell outside the 80% interval`;
      }
      return null;
    }
    case "quality_change":
      return hits.length && e.quality >= rule.minQuality ? `Evidence quality ${e.quality} for ${hits.map((h) => h.ticker).join(", ")}` : null;
  }
}

export function matchAlerts(events: readonly AlertableEvent[], rules: readonly AlertRule[], prior: readonly AlertDelivery[], now: Date): AlertDelivery[] {
  const out: AlertDelivery[] = [];
  const delivered = new Set(prior.map((d) => `${d.ruleId}|${d.eventId}`));
  for (const rule of rules) {
    if (rule.paused) continue;
    const hourAgo = now.getTime() - 3_600_000;
    let recent = prior.filter((d) => d.ruleId === rule.id && d.status === "delivered" && Date.parse(d.at) >= hourAgo).length;
    const sorted = [...events].sort((a, b) => a.firstPublishedAt.localeCompare(b.firstPublishedAt));
    for (const e of sorted) {
      const key = `${rule.id}|${e.id}`;
      if (delivered.has(key)) continue;
      const reason = matchReason(rule, e);
      if (!reason) continue;
      delivered.add(key);
      const status: AlertDelivery["status"] = rule.digest ? "digested" : recent >= rule.maxPerHour ? "throttled" : "delivered";
      if (status === "delivered") recent++;
      out.push({ id: `${rule.id}:${e.id}`, ruleId: rule.id, eventId: e.id, at: now.toISOString(), title: e.bottomLine, reason, read: false, status });
    }
  }
  return out;
}
