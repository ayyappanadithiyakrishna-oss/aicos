/**
 * Options-implied move — a DIFFERENT quantity from the model's event-reaction estimate.
 * It is a market-priced magnitude (no direction). Only computed from an entitled, fresh chain.
 */

import { lastCloseAtOrBefore, sessionOn } from "@/lib/calendar/nyse";
import { dateKeyOf } from "@/lib/calendar/time";

export interface OptionsInput {
  spot: number;
  /** Annualized implied volatility (decimal), e.g. 0.32. */
  ivAnnual: number;
  tradingDays: number;
  ivAsOf: string;
  expiry: string;
  source: string;
  entitled: boolean;
}

export type ImpliedMove =
  | { available: false; reason: string }
  | {
      available: true;
      method: "iv_sqrt_time" | "atm_straddle";
      movePct: number;
      moveAbs: number;
      assumptions: string[];
      asOf: string;
      expiry: string;
      source: string;
    };

const MAX_IV_AGE_MS = 30 * 60 * 1000;

/** One-standard-deviation close-to-close approximation: S × σ × √(d / 252). */
export function impliedMoveFromIv(inp: OptionsInput | null, now: Date): ImpliedMove {
  if (!inp) return { available: false, reason: "No entitled options data source configured." };
  if (!inp.entitled) return { available: false, reason: "Options data present but not entitled for display." };
  if (!(inp.ivAnnual > 0) || !(inp.spot > 0) || !(inp.tradingDays > 0)) return { available: false, reason: "Missing or invalid IV/spot." };
  if (now.getTime() - Date.parse(inp.ivAsOf) > MAX_IV_AGE_MS) return { available: false, reason: "Implied volatility is stale." };
  const moveAbs = inp.spot * inp.ivAnnual * Math.sqrt(inp.tradingDays / 252);
  return {
    available: true,
    method: "iv_sqrt_time",
    movePct: (100 * moveAbs) / inp.spot,
    moveAbs,
    assumptions: [
      "One standard deviation, close-to-close, lognormal approximation",
      "252 trading days per year; no event-variance decomposition",
      "Magnitude only — not a direction forecast",
    ],
    asOf: inp.ivAsOf,
    expiry: inp.expiry,
    source: inp.source,
  };
}

/** ATM straddle approximation: expected |move| ≈ 0.8 × straddle price (≈ √(2/π) σ√t). */
export function impliedMoveFromStraddle(
  inp: { spot: number; callMid: number; putMid: number; multiplier: number; asOf: string; expiry: string; source: string; entitled: boolean } | null,
  now: Date,
): ImpliedMove {
  if (!inp) return { available: false, reason: "No entitled options data source configured." };
  if (!inp.entitled) return { available: false, reason: "Options data present but not entitled for display." };
  if (now.getTime() - Date.parse(inp.asOf) > MAX_IV_AGE_MS) return { available: false, reason: "Option quotes are stale." };
  const straddle = inp.callMid + inp.putMid; // per-share premium (quotes are per share; multiplier documents contract size)
  const moveAbs = straddle;
  return {
    available: true,
    method: "atm_straddle",
    movePct: (100 * moveAbs) / inp.spot,
    moveAbs,
    assumptions: [
      `ATM straddle mid ${straddle.toFixed(2)} per share (contract multiplier ${inp.multiplier})`,
      "Expected absolute move ≈ ATM straddle premium (before fees; 1σ ≈ straddle / 0.80)",
      "Magnitude only — not a direction forecast",
    ],
    asOf: inp.asOf,
    expiry: inp.expiry,
    source: inp.source,
  };
}

export interface EodStraddleInput {
  spot: number;
  spotAsOf: string;
  strike: number;
  callClose: number;
  putClose: number;
  /** Session date of the option closes (YYYY-MM-DD). */
  optionsDate: string;
  expiry: string;
  /** Trading sessions from the option close to expiry (≥ 1). */
  tradingDays: number;
  contracts: { call: string; put: string };
  source: string;
}

export type EodImpliedMove =
  | { available: false; reason: string }
  | {
      available: true;
      method: "atm_straddle_eod";
      /** Expected absolute move to expiry ≈ ATM straddle / spot, percent. */
      movePct: number;
      moveAbs: number;
      /** Implied one-standard-deviation move per session, percent: σ_T / √d with σ_T = straddle / (√(2/π)·S). */
      sessionSigmaPct: number;
      /** Annualized implied volatility from the straddle, percent. */
      ivAnnualPct: number;
      strike: number;
      straddle: number;
      expiry: string;
      tradingDays: number;
      optionsDate: string;
      contracts: { call: string; put: string };
      assumptions: string[];
      source: string;
    };

const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI);
const MAX_EOD_AGE_DAYS = 5;

/** End-of-day ATM straddle → implied move. Magnitude only; never a direction. */
export function impliedMoveFromEodStraddle(inp: EodStraddleInput | null, now: Date): EodImpliedMove {
  if (!inp) return { available: false, reason: "No options data for this underlying." };
  if (![inp.spot, inp.strike, inp.callClose, inp.putClose, inp.tradingDays].every(Number.isFinite) || !(inp.spot > 0) || !(inp.callClose > 0) || !(inp.putClose > 0) || !(inp.tradingDays >= 1)) return { available: false, reason: "Missing option closes or spot price." };
  const session = sessionOn(inp.optionsDate);
  const spotTime = Date.parse(inp.spotAsOf);
  if (!session || !Number.isFinite(spotTime) || !/^\d{4}-\d{2}-\d{2}$/.test(inp.expiry) || !Number.isFinite(Date.parse(inp.expiry))) return { available: false, reason: "Invalid option or spot date." };
  if (session.close.getTime() > now.getTime() || spotTime > now.getTime()) return { available: false, reason: "Option or spot data is future-dated." };
  if (dateKeyOf(new Date(spotTime)) !== inp.optionsDate) return { available: false, reason: "Spot and option closes are from different sessions." };
  if (inp.expiry <= inp.optionsDate || inp.expiry < dateKeyOf(now)) return { available: false, reason: "Option contracts have expired." };
  if (now.getTime() - session.close.getTime() > MAX_EOD_AGE_DAYS * 86_400_000 || lastCloseAtOrBefore(now).date !== inp.optionsDate) return { available: false, reason: "Option closes are stale." };
  if (Math.abs(inp.strike - inp.spot) / inp.spot > 0.05) return { available: false, reason: "No near-the-money strike available." };
  const straddle = inp.callClose + inp.putClose;
  const sigmaT = straddle / (SQRT_2_OVER_PI * inp.spot);
  const sessionSigmaPct = (100 * sigmaT) / Math.sqrt(inp.tradingDays);
  return {
    available: true,
    method: "atm_straddle_eod",
    movePct: (100 * straddle) / inp.spot,
    moveAbs: straddle,
    sessionSigmaPct,
    ivAnnualPct: sessionSigmaPct * Math.sqrt(252),
    strike: inp.strike,
    straddle,
    expiry: inp.expiry,
    tradingDays: inp.tradingDays,
    optionsDate: inp.optionsDate,
    contracts: inp.contracts,
    assumptions: [
      `ATM ${inp.strike} straddle closed at ${straddle.toFixed(2)} per share on ${inp.optionsDate}`,
      "Expected absolute move to expiry ≈ straddle ÷ spot; 1σ ≈ straddle ÷ (0.80 × spot)",
      "End-of-day option closes (not live quotes); includes all scheduled events before expiry",
      "Magnitude only — not a direction forecast",
    ],
    source: inp.source,
  };
}
