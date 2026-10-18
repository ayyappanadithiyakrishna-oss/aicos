/**
 * Priced-in meter with integrity rules. Three distinct quantities, never blended into one
 * invented "% priced in":
 *   (a) pre-event drift  (b) reaction already observed since publication  (c) modeled remaining move
 * (c) is only estimable when the model was conditioned on prices known at the analysis time;
 * otherwise it is reported as unknown.
 */
import type { PriceBar, PricedIn } from "@/lib/domain/types";
import { horizonWindow } from "@/lib/calendar/horizons";
import { PointInTimeView, preEventDriftPct } from "./features";
import { lastBarAtOrBefore, logReturnPct } from "./returns";

export function pricedIn(args: {
  securityId: string;
  ticker: string;
  publishedAt: string;
  analysisAt: string;
  dailyBars: readonly PriceBar[] | null;
  intradayBars: readonly PriceBar[] | null;
  /** Conditional remaining-move model output, if a model conditioned on realized move exists. */
  remainingModelPct?: number | null;
}): PricedIn {
  const { securityId, ticker } = args;
  if (!args.dailyBars?.length) {
    return {
      securityId,
      ticker,
      preEventDriftPct: null,
      realizedSincePct: null,
      remainingPct: null,
      status: "unknown",
      note: "Unknown — no valid pre/post-event quotes.",
    };
  }
  const pubView = new PointInTimeView(args.publishedAt);
  const drift = preEventDriftPct(pubView, args.dailyBars, 5);
  const bars = args.intradayBars?.length ? args.intradayBars : args.dailyBars;
  const w = horizonWindow(new Date(args.publishedAt), "next_session");
  const p0 = lastBarAtOrBefore(bars, w.start);
  const p1 = lastBarAtOrBefore(bars, new Date(args.analysisAt));
  const realized = p0 && p1 && p1.t !== p0.t && Date.parse(p1.t) > Date.parse(p0.t) ? logReturnPct(p0.c, p1.c) : null;
  const remaining = args.remainingModelPct ?? null;
  return {
    securityId,
    ticker,
    preEventDriftPct: drift,
    realizedSincePct: realized,
    remainingPct: remaining,
    status: remaining !== null ? "estimable" : drift !== null || realized !== null ? "partial" : "unknown",
    note:
      remaining !== null
        ? "Remaining move conditioned on prices known at analysis time."
        : "Remaining move not estimable: no model is conditioned on the realized reaction.",
  };
}
