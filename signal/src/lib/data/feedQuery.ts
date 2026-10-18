/** Pure feed filtering, sorting and cursor pagination (shared by demo and live services). */
import { z } from "zod";
import type { IntelligenceEvent, Severity } from "@/lib/domain/types";
import type { FeedQuery } from "./views";
import { relevance } from "@/lib/analysis/ranking";

export const CATEGORIES: Array<{ key: string; label: string; match: (e: IntelligenceEvent) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "market_moving", label: "Market-moving", match: (e) => e.tags.includes("market_moving") },
  { key: "macro", label: "Macro", match: (e) => e.eventType === "macro" },
  { key: "earnings", label: "Earnings", match: (e) => e.eventType === "earnings" },
  { key: "filings", label: "Filings", match: (e) => e.tags.includes("filing") || e.eventType === "filing" },
  { key: "ma", label: "M&A", match: (e) => e.eventType === "ma" },
  { key: "regulation", label: "Regulation", match: (e) => e.eventType === "regulation" },
  { key: "geopolitics", label: "Geopolitics", match: (e) => e.eventType === "geopolitics" },
  { key: "sector", label: "Sectors", match: (e) => e.eventType === "sector" || e.sectors.length > 0 },
];

export const FeedQuerySchema = z.object({
  category: z.string().max(32).optional(),
  severity: z.enum(["high", "medium", "low"]).optional(),
  direction: z.enum(["bullish", "bearish", "no_edge", "mixed", "insufficient"]).optional(),
  horizon: z.enum(["1h", "next_session", "5_sessions"]).optional(),
  minQuality: z.coerce.number().int().min(0).max(100).optional(),
  recency: z.enum(["1h", "today", "3d", "7d", "all"]).optional(),
  verifiedOnly: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .optional(),
  q: z.string().trim().max(120).optional(),
  tickers: z
    .union([z.array(z.string()), z.string()])
    .transform((v) => (Array.isArray(v) ? v : v.split(",")).map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z.]{1,8}$/.test(t)).slice(0, 50))
    .optional(),
  sort: z.enum(["relevance", "recency"]).optional(),
  prioritize: z.enum(["market", "watchlist"]).optional(),
  watch: z
    .string()
    .transform((v) => v.split(",").map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z.]{1,8}$/.test(t)).slice(0, 50))
    .optional(),
  format: z.enum(["card", "full"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const CursorSchema = z.object({ o: z.number().int().min(0), a: z.string() });

export function encodeCursor(offset: number, asOf: string): string {
  return Buffer.from(JSON.stringify({ o: offset, a: asOf })).toString("base64url");
}

export function decodeCursor(c: string | undefined): { o: number; a: string } | null {
  if (!c) return null;
  try {
    return CursorSchema.parse(JSON.parse(Buffer.from(c, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

const VERIFIED = new Set(["confirmed_filing", "official_release", "multiple_independent"]);
const SEV_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export function primaryForecastDirection(e: IntelligenceEvent, horizon = "next_session"): string[] {
  return e.forecasts.filter((f) => f.horizon === horizon).map((f) => f.direction);
}

export function matchesQuery(e: IntelligenceEvent, q: FeedQuery, asOf: Date): boolean {
  const cat = CATEGORIES.find((c) => c.key === (q.category ?? "all"));
  if (cat && !cat.match(e)) return false;
  if (q.category === "watchlist" && !(q.tickers?.length && e.exposures.some((x) => q.tickers!.includes(x.ticker)))) return false;
  if (q.severity && SEV_RANK[e.severity] < SEV_RANK[q.severity]) return false;
  if (q.direction && !primaryForecastDirection(e, q.horizon ?? "next_session").includes(q.direction)) return false;
  if (q.minQuality !== undefined && e.quality.score < q.minQuality) return false;
  if (q.verifiedOnly && !VERIFIED.has(e.confirmationStatus)) return false;
  if (q.recency && q.recency !== "all") {
    const ageH = (asOf.getTime() - Date.parse(e.firstPublishedAt)) / 3_600_000;
    const lim = q.recency === "1h" ? 1 : q.recency === "today" ? 24 : q.recency === "3d" ? 72 : 168;
    if (ageH > lim) return false;
  }
  if (q.tickers?.length && q.category !== "watchlist" && !e.exposures.some((x) => q.tickers!.includes(x.ticker))) return false;
  if (q.q) {
    const needle = q.q.toLowerCase();
    const hay = [e.bottomLine, e.originalTitle, e.subtype, e.whyItMatters, ...e.exposures.flatMap((x) => [x.ticker, x.name])].join(" ").toLowerCase();
    if (!needle.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

export function queryFeed(events: readonly IntelligenceEvent[], q: FeedQuery, asOf: Date) {
  let pool = events;
  if (q.prioritize === "watchlist" && q.watch?.length) {
    // Re-rank with the watchlist weight boosted; the documented function is unchanged.
    const watch = new Set(q.watch);
    pool = events.map((e) => ({ ...e, relevance: relevance(e, { now: asOf, watchlist: watch, prioritize: "watchlist" }) }));
  }
  const filtered = pool.filter((e) => matchesQuery(e, q, asOf));
  const sorted = [...filtered].sort((a, b) =>
    q.sort === "recency" ? Date.parse(b.firstPublishedAt) - Date.parse(a.firstPublishedAt) : b.relevance.score - a.relevance.score,
  );
  const limit = q.limit ?? 25;
  const cur = decodeCursor(q.cursor);
  const offset = cur && cur.a === asOf.toISOString() ? cur.o : 0;
  const page = sorted.slice(offset, offset + limit);
  const nextCursor = offset + limit < sorted.length ? encodeCursor(offset + limit, asOf.toISOString()) : null;
  const categories = CATEGORIES.map((c) => ({ key: c.key, label: c.label, count: events.filter(c.match).length }));
  return { items: page, total: sorted.length, nextCursor, categories };
}
