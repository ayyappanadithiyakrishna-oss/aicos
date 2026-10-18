import type { Horizon } from "@/lib/domain/types";
import { addTradingMinutes, dayZeroSession, lastCloseAtOrBefore, nthSessionClose, sessionState } from "./nyse";

export interface HorizonWindow {
  horizon: Horizon;
  /** Baseline price timestamp: the last regular-session price available at publication. */
  start: Date;
  /** Window end: horizon maturity. */
  end: Date;
  baselineRule: "intraday_last_trade" | "prior_regular_close";
  /** Trading-day count used to scale volatility (fractional for 1h). */
  tradingDays: number;
}

export const HORIZON_LABEL: Record<Horizon, string> = {
  "1h": "1 trading hour",
  next_session: "Next session close",
  "5_sessions": "5 sessions",
};

export const HORIZON_SHORT: Record<Horizon, string> = {
  "1h": "1h",
  next_session: "Next sess.",
  "5_sessions": "5 sess.",
};

/**
 * Event windows use regular-session prices only. For publications outside regular hours the
 * baseline is the prior regular close, so pre-/post-market reaction is included in the window.
 * - 1h: 60 minutes of regular-session time from publication (or from the next open).
 * - next_session: close of the first regular session ending after publication ("day 0").
 * - 5_sessions: close of the 5th session counting day 0 as the first.
 */
export function horizonWindow(publishedAt: Date, horizon: Horizon): HorizonWindow {
  const state = sessionState(publishedAt);
  const intraday = state === "regular";
  const start = intraday ? publishedAt : lastCloseAtOrBefore(publishedAt).close;
  const baselineRule = intraday ? "intraday_last_trade" : "prior_regular_close";
  if (horizon === "1h") {
    return { horizon, start, end: addTradingMinutes(publishedAt, 60), baselineRule, tradingDays: 1 / 6.5 };
  }
  if (horizon === "next_session") {
    return { horizon, start, end: dayZeroSession(publishedAt).close, baselineRule, tradingDays: 1 };
  }
  return { horizon, start, end: nthSessionClose(publishedAt, 5).close, baselineRule, tradingDays: 5 };
}
