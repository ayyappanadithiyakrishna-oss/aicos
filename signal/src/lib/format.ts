/** Display formatting shared by server and client components. */
import type { ConfirmationStatus, Direction, Horizon, QualityTier, Relationship } from "@/lib/domain/types";

const MINUS = "−";

export function signedPct(x: number | null | undefined, opts: { dp?: number; withSign?: boolean } = {}): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const dp = opts.dp ?? (Math.abs(x) < 0.1 && x !== 0 ? 2 : 1);
  const v = Math.abs(x).toFixed(dp);
  if (Number(v) === 0) return `${(0).toFixed(dp)}%`;
  const sign = x > 0 ? (opts.withSign === false ? "" : "+") : MINUS;
  return `${sign}${v}%`;
}

export function pct(x: number | null | undefined, dp = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(dp)}%`;
}

export function num(x: number | null | undefined, dp = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function compact(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(x);
}

const etFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const etDateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const etFullFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const utcFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });

export function timeET(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${etFmt.format(new Date(iso))} ET`;
}

export function dateET(iso: string | null | undefined): string {
  if (!iso) return "—";
  return etDateFmt.format(new Date(iso));
}

export function dateTimeET(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${etFullFmt.format(new Date(iso))} ET`;
}

export function timeUTC(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${utcFmt.format(new Date(iso))} UTC`;
}

/** "08:30 ET" today relative to the reference instant, else "Oct 13 · 16:05 ET". */
export function stampET(iso: string, ref: string): string {
  const same = etDateFmt.format(new Date(iso)) === etDateFmt.format(new Date(ref));
  return same ? timeET(iso) : `${dateET(iso)} · ${timeET(iso)}`;
}

export function relative(iso: string, ref: string): string {
  const mins = Math.round((Date.parse(ref) - Date.parse(iso)) / 60000);
  if (mins < 0) {
    const m = -mins;
    if (m < 60) return `in ${m}m`;
    if (m < 60 * 48) return `in ${Math.round(m / 60)}h`;
    return `in ${Math.round(m / 1440)}d`;
  }
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export const DIRECTION_LABEL: Record<Direction, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  no_edge: "No material edge",
  mixed: "Mixed",
  insufficient: "Insufficient data",
};

export const DIRECTION_SHORT: Record<Direction, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  no_edge: "No edge",
  mixed: "Mixed",
  insufficient: "Insufficient",
};

/** Text color token per direction: green/red only for directional calls. */
export const DIRECTION_TONE: Record<Direction, "pos" | "neg" | "muted" | "warn"> = {
  bullish: "pos",
  bearish: "neg",
  no_edge: "muted",
  mixed: "warn",
  insufficient: "muted",
};

export const TIER_LABEL: Record<QualityTier, string> = {
  calibrated: "Calibrated",
  evaluated: "Evaluated · uncalibrated probabilities",
  research: "Research-grade / uncalibrated",
  direction_only: "Direction only",
  insufficient: "Insufficient data",
};

export const TIER_SHORT: Record<QualityTier, string> = {
  calibrated: "Calibrated",
  evaluated: "Evaluated",
  research: "Research",
  direction_only: "Direction only",
  insufficient: "Abstain",
};

export const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  direct: "Direct",
  supplier: "Supplier",
  customer: "Customer",
  competitor: "Competitor",
  index: "Index / ETF",
  sector: "Sector",
  rate_sensitivity: "Rate sensitivity",
  commodity_sensitivity: "Commodity sensitivity",
  fx_sensitivity: "FX sensitivity",
  hypothesized: "Hypothesized",
};

export const CONFIRMATION_LABEL: Record<ConfirmationStatus, string> = {
  confirmed_filing: "Confirmed filing",
  official_release: "Official release",
  multiple_independent: "Multiple independent",
  single_source: "Single source",
  unverified: "Unverified",
};

export const HORIZON_SHORT: Record<Horizon, string> = { "1h": "1h", next_session: "Next sess.", "5_sessions": "5 sess." };
export const HORIZON_LONG: Record<Horizon, string> = { "1h": "1 trading hour", next_session: "Next session close", "5_sessions": "5 sessions" };

export function subtypeLabel(subtype: string): string {
  const map: Record<string, string> = {
    "macro.cpi": "CPI release",
    "macro.pce": "PCE release",
    "macro.payrolls": "Payrolls",
    "macro.fomc": "FOMC decision",
    "macro.retail_sales": "Retail sales",
    "macro.gdp": "GDP",
    "macro.pmi": "PMI",
    "macro.jobless_claims": "Jobless claims",
    "earnings.report": "Earnings",
    "earnings.guidance": "Guidance",
    "ma.announced": "M&A announced",
    "ma.completed": "M&A completed",
    "regulation.drug_approval": "Regulatory decision",
    "regulation.antitrust": "Antitrust",
    "regulation.export_controls": "Export controls",
    "geopolitics.oil_supply": "Oil supply shock",
    "geopolitics.shipping": "Shipping disruption",
    "company.cyber_incident": "Cyber incident",
    "company.credit_downgrade": "Credit downgrade",
    "company.recall": "Recall",
    "company.leadership_change": "Leadership change",
    "company.buyback": "Buyback",
    "company.material_agreement": "Material agreement",
    "company.restructuring": "Restructuring",
    "company.restatement": "Restatement",
    "filing.insider_form4": "Insider filing",
    "filing.other_event": "8-K other event",
    "sector.supply_shortage": "Supply shortage",
    "sector.price_war": "Price cuts",
    "other.unclassified": "Unclassified",
  };
  return map[subtype] ?? subtype.split(".").pop()!.replace(/_/g, " ");
}

export const REASON_SHORT: Record<string, string> = {
  NO_PRICE_HISTORY: "No price history",
  NO_BASELINE_PRICE: "No baseline price",
  SYMBOL_MAPPING_DOUBT: "Ticker link unverified",
  UNVERIFIED_NUMERIC_FACTS: "Numbers unverified",
  STALE_PROVIDER: "Stale feed",
  NO_TRAINED_MODEL: "No trained model",
  SPARSE_GROUP: "Few comparable events",
  NO_COMPARABLE_HISTORY: "No comparable history",
  SOURCE_CONFLICT: "Sources conflict",
  EVENT_OVERLAP: "Overlapping catalysts",
  BELOW_NOISE: "Below normal volatility",
  UNCALIBRATED_PROBABILITIES: "Probabilities withheld",
  CALIBRATED: "Calibrated",
  INTERVAL_UNAVAILABLE: "No interval",
};
