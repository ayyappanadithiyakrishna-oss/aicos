/**
 * Live coverage universe: US-listed companies with market cap ≥ $10B (snapshot built by
 * scripts/build-universe.mts). Anything outside it is not resolved, so small caps never appear.
 */
import type { Security } from "@/lib/domain/types";
import data from "./universe.json";

interface Row {
  t: string;
  n: string;
  x: string | null;
  s: string | null;
  i: string | null;
  cap: number;
  logo: string | null;
  web: string | null;
}

export const UNIVERSE_META = { generatedAt: data.generatedAt, minMarketCapUsd: data.minMarketCapUsd, source: data.source };

const rows = data.securities as Row[];
const byTicker = new Map(rows.map((r) => [r.t, r]));

export const universeRow = (ticker: string): Row | undefined => byTicker.get(ticker.toUpperCase());

export const UNIVERSE: Security[] = rows.map((r) => ({
  id: `us:${r.t}`,
  ticker: r.t,
  name: r.n,
  kind: "equity",
  exchange: r.x ?? "US",
  currency: "USD",
  sector: r.s ?? "Unclassified",
  industry: r.i ?? "Unclassified",
  marketCapBucket: r.cap >= 200e9 ? "mega" : "large",
  beta: null,
  sigmaDaily: null,
  benchmarkId: "live:SPY",
  isSynthetic: false,
  brandingRights: r.logo ? "licensed" : "none",
  tickerHistory: [],
}));
