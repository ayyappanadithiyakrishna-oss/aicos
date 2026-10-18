import { describe, expect, it } from "vitest";
import { matchAlerts, type AlertRule, type AlertableEvent } from "@/lib/alerts/match";

const rule = (o: Partial<AlertRule> = {}): AlertRule => ({ id: "r1", kind: "watchlist_material", label: "x", tickers: ["HLCN"], minSeverity: "medium", minQuality: 50, paused: false, digest: false, maxPerHour: 2, createdAt: "2026-10-14T00:00:00Z", ...o });
const ev = (id: string, o: Partial<AlertableEvent> = {}): AlertableEvent => ({ id, firstPublishedAt: `2026-10-14T1${id.length}:00:00Z`, severity: "high", quality: 80, bottomLine: id, tags: [], exposures: [{ ticker: "HLCN", directness: "direct", forecasts: {} }], ...o });
const now = new Date("2026-10-14T18:30:00Z");

describe("alert matching", () => {
  it("matches watchlist events and never re-fires the same cluster", () => {
    const first = matchAlerts([ev("a")], [rule()], [], now);
    expect(first).toHaveLength(1);
    expect(matchAlerts([ev("a")], [rule()], first, now)).toHaveLength(0);
  });
  it("respects severity and quality thresholds", () => {
    expect(matchAlerts([ev("a", { severity: "low" })], [rule()], [], now)).toHaveLength(0);
    expect(matchAlerts([ev("a", { quality: 10 })], [rule()], [], now)).toHaveLength(0);
  });
  it("throttles beyond the hourly cap instead of spamming", () => {
    const out = matchAlerts([ev("a"), ev("bb"), ev("ccc"), ev("dddd")], [rule({ maxPerHour: 2 })], [], now);
    expect(out.filter((d) => d.status === "delivered")).toHaveLength(2);
    expect(out.filter((d) => d.status === "throttled")).toHaveLength(2);
  });
  it("paused rules do nothing; digest rules collect instead of delivering", () => {
    expect(matchAlerts([ev("a")], [rule({ paused: true })], [], now)).toHaveLength(0);
    expect(matchAlerts([ev("a")], [rule({ digest: true })], [], now)[0]!.status).toBe("digested");
  });
  it("flags realized moves that fall outside the forecast interval", () => {
    const e = ev("a", { exposures: [{ ticker: "HLCN", directness: "direct", forecasts: { next_session: { central: 1, lo: -1, hi: 2, realized: { ar: -4, status: "resolved" } } } }] });
    expect(matchAlerts([e], [rule({ kind: "forecast_invalidation" })], [], now)[0]!.reason).toMatch(/outside the 80% interval/);
  });
  it("detects newly identified second-order exposure", () => {
    const e = ev("a", { exposures: [{ ticker: "HLCN", directness: "second_order", forecasts: {} }] });
    expect(matchAlerts([e], [rule({ kind: "second_order" })], [], now)).toHaveLength(1);
    expect(matchAlerts([ev("b")], [rule({ kind: "second_order" })], [], now)).toHaveLength(0);
  });
});
