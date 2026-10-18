import type { PriceBar, Quote } from "@/lib/domain/types";

/** Read-only price access used by scoring, resolution and the UI. */
export interface PriceStore {
  entitlement: Quote["entitlement"];
  delayMinutes: number | null;
  source: string;
  daily(securityId: string): readonly PriceBar[] | null;
  intraday(securityId: string): readonly PriceBar[] | null;
  splits(securityId: string): ReadonlyArray<{ effective: string; ratio: number }>;
}

export const NO_PRICES: PriceStore = {
  entitlement: "none",
  delayMinutes: null,
  source: "No licensed price provider configured",
  daily: () => null,
  intraday: () => null,
  splits: () => [],
};
