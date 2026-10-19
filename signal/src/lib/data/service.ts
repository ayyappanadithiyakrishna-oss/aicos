import "server-only";
/**
 * Mode-aware data service. DEMO (default) and LIVE are strictly separate code paths: demo data is
 * never returned in live mode, and live provider data never enters the demo world.
 */
import { isDemoMode } from "@/lib/config/env";
import * as demo from "./demoService";
import * as live from "./liveService";
import type { ArchiveQuery, FeedQuery } from "./views";

export const isDemo = () => isDemoMode();

export const getFeed = (q: FeedQuery) => (isDemo() ? demo.demoFeed(q) : live.liveFeed(q));
export const getEvent = (id: string) => (isDemo() ? demo.demoEvent(id) : live.liveEvent(id));
export const getRibbon = () => (isDemo() ? demo.demoRibbon() : live.liveRibbon());
export const getTicker = (s: string) => (isDemo() ? demo.demoTicker(s) : live.liveTicker(s));
export const getPulse = () => (isDemo() ? demo.demoPulse() : live.livePulse());
export const getMacro = () => (isDemo() ? demo.demoMacro() : live.liveMacro());
export const getEarningsAndFilings = () => (isDemo() ? demo.demoEarningsAndFilings() : live.liveEarningsAndFilings());
export const getCalendar = () => (isDemo() ? demo.demoCalendar() : live.liveCalendar());
export const getScorecard = (opts: { from?: string; to?: string; minSample?: number } = {}) => (isDemo() ? demo.demoScorecardView(opts) : live.liveScorecard());
export const getArchive = (q: ArchiveQuery) => (isDemo() ? demo.demoArchive(q) : live.liveArchive(q));
export const getStatus = () => (isDemo() ? demo.demoStatus() : live.liveStatus());
export const search = (q: string) => (isDemo() ? demo.demoSearch(q) : live.liveSearch(q));
export const getSource = (id: string) => (isDemo() ? demo.demoSource(id) : Promise.resolve(null));

export async function getImpactHistory(symbol: string) {
  const t = await getTicker(symbol);
  return t ? { mode: t.mode, ticker: t.security.ticker, rows: t.impactHistory } : null;
}

export async function getSecurityIndex() {
  if (isDemo()) return (await demo.demoSecurities()).map((s) => ({ ticker: s.ticker, name: s.name, kind: s.kind }));
  const [{ LIVE_PROXIES }, { UNIVERSE }] = await Promise.all([import("@/lib/live/master"), import("@/lib/live/universe")]);
  return [...LIVE_PROXIES, ...UNIVERSE.slice(0, 120)].map((s) => ({ ticker: s.ticker, name: s.name, kind: s.kind }));
}
