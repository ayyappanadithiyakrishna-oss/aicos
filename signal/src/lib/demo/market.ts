/**
 * DEMO synthetic market. A deterministic data-generating process (DGP) produces:
 *   - a regime-switching market factor plus rates, oil and dollar factors;
 *   - scheduled macro releases and random company events whose exposures are selected by the SAME
 *     mechanism templates the live pipeline uses;
 *   - daily bars (full history) and 30-minute bars (recent window) with event jumps injected.
 * The model is later trained on reactions MEASURED from these bars, exactly as it would be on
 * licensed history. Nothing here is real market data.
 */
import type { PriceBar, Security } from "@/lib/domain/types";
import { addDaysToKey, dateKeyOf, weekdayOfKey, zonedToUtc } from "@/lib/calendar/time";
import { isTradingDay, nextTradingDay, sessionOn, type Session } from "@/lib/calendar/nyse";
import { buildMechanism, type Shock } from "@/lib/analysis/mechanisms";
import type { SecurityMaster } from "@/lib/analysis/securityMaster";
import { surpriseBucket } from "@/lib/quant/features";
import { hash32, heavyTail, mulberry32, normal, pick, studentT, type Rng } from "@/lib/quant/stats";
import { DEMO_SPECS } from "./universe";

export const HISTORY_START = "2023-01-03";
export const INTRADAY_SESSIONS = 300;
const HALF_HOURS = 13;

export type Regime = "calm" | "normal" | "stressed";
const REGIME_VOL: Record<Regime, number> = { calm: 0.0072, normal: 0.0105, stressed: 0.0175 };

export interface SyntheticExposure {
  securityId: string;
  channelKey: string;
  sign: "positive" | "negative" | "mixed";
  relationship: string;
  /** True standardized next-session effect (DGP parameter, never shown to the model). */
  yTrue: number;
}

export interface SyntheticEvent {
  id: string;
  at: string;
  subtype: string;
  bucket: string;
  shock: Shock;
  magnitudeZ: number | null;
  issuerId: string | null;
  title: string;
  exposures: SyntheticExposure[];
  regime: Regime;
  isCurrent: boolean;
}

export interface MarketData {
  sessions: Session[];
  daily: Map<string, PriceBar[]>;
  intraday: Map<string, PriceBar[]>;
  regimeByDate: Map<string, Regime>;
  history: SyntheticEvent[];
}

// ---------------------------------------------------------------------------------------------
// True effects (DGP). The model must learn these from measured reactions.

export function trueEffectY(subtype: string, channelKey: string, z: number | null, shock: Shock, loadingAbs: number): number {
  const [rel, sg] = channelKey.split(":");
  const s = sg === "positive" ? 1 : sg === "negative" ? -1 : 0;
  const mag = z !== null ? Math.min(3, Math.abs(z)) : 1;
  const L = (ref: number) => Math.pow(Math.max(0.1, loadingAbs) / ref, 0.7);
  if (subtype === "macro.cpi" || subtype === "macro.pce" || subtype === "macro.fomc") {
    if (rel === "rate_sensitivity") return s * 0.45 * mag * L(10);
    if (rel === "fx_sensitivity") return s * 0.22 * mag;
    return 0;
  }
  if (subtype.startsWith("macro.")) {
    if (rel === "rate_sensitivity") return s * 0.28 * mag * L(10);
    if (rel === "index") return 0.06 * shock * mag;
    return 0;
  }
  if (subtype === "geopolitics.oil_supply") return s * 0.5 * mag * L(6);
  if (subtype.startsWith("earnings.")) {
    if (rel === "direct") return z !== null ? 0.75 * Math.max(-3, Math.min(3, z)) : 0.9 * shock;
    if (rel === "supplier") return s * 0.28 * mag;
    if (rel === "competitor") return s * 0.08 * mag;
    if (rel === "index") return s * 0.15 * mag;
    return 0;
  }
  if (subtype.startsWith("ma.")) {
    if (rel === "direct") return s > 0 ? 2.6 : -0.35;
    if (rel === "competitor") return 0.25;
    return 0;
  }
  if (subtype === "regulation.drug_approval") return rel === "direct" ? s * 1.6 : rel === "competitor" ? s * 0.3 : 0;
  if (subtype === "regulation.export_controls") return rel === "direct" ? -1.3 : rel === "supplier" ? -0.5 : rel === "customer" ? -0.3 : 0.1;
  if (subtype === "sector.supply_shortage") return rel === "direct" ? 0.7 : rel === "customer" ? -0.35 : rel === "competitor" ? 0.3 : 0;
  const adverse: Record<string, number> = {
    "company.cyber_incident": -0.9,
    "company.credit_downgrade": -1.2,
    "regulation.antitrust": -0.7,
    "company.recall": -0.8,
    "company.restatement": -2,
  };
  if (subtype in adverse) return rel === "direct" ? adverse[subtype]! : rel === "index" ? -0.12 : rel === "competitor" ? 0.1 : 0;
  if (subtype === "company.buyback") return rel === "direct" ? 0.6 : 0;
  if (subtype === "filing.insider_form4") return rel === "direct" ? 0.35 * shock : 0;
  if (subtype === "company.leadership_change") return rel === "direct" ? -0.2 : 0;
  return 0;
}

// ---------------------------------------------------------------------------------------------

function tradingSessions(fromKey: string, toKey: string): Session[] {
  const out: Session[] = [];
  let d = fromKey;
  while (d <= toKey) {
    if (isTradingDay(d)) out.push(sessionOn(d)!);
    d = addDaysToKey(d, 1);
  }
  return out;
}

function firstTradingOnOrAfter(dk: string): string {
  let d = dk;
  while (!isTradingDay(d)) d = addDaysToKey(d, 1);
  return d;
}

const FOMC_MONTH_DAY: Array<[number, number]> = [[1, 29], [3, 18], [5, 6], [6, 17], [7, 29], [9, 17], [11, 5], [12, 16]];

interface EventDraft {
  at: string;
  subtype: string;
  z: number | null;
  shock: Shock;
  issuerId: string | null;
  counterpartyId: string | null;
  dealRole: "target" | "acquirer" | "none";
  guidance: "raised" | "lowered" | "reaffirmed" | "initiated" | "withdrawn" | "none";
  label: string | null;
  title: string;
}

const COMPANY_SUBTYPES: Array<[string, number]> = [
  ["earnings.report", 30],
  ["earnings.guidance", 6],
  ["ma.announced", 4],
  ["regulation.drug_approval", 3],
  ["regulation.export_controls", 1.5],
  ["regulation.antitrust", 2.5],
  ["company.cyber_incident", 2.5],
  ["company.credit_downgrade", 3],
  ["company.recall", 1.5],
  ["company.buyback", 5],
  ["filing.insider_form4", 8],
  ["company.leadership_change", 5],
  ["sector.supply_shortage", 2],
  ["geopolitics.oil_supply", 2.5],
];

function weighted<T>(rng: Rng, xs: ReadonlyArray<[T, number]>): T {
  const total = xs.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [x, w] of xs) {
    r -= w;
    if (r <= 0) return x;
  }
  return xs[xs.length - 1]![0];
}

function scheduleMacro(sessions: Session[], endKey: string, rng: Rng): EventDraft[] {
  const out: EventDraft[] = [];
  const start = sessions[0]!.date;
  const months: string[] = [];
  for (let y = 2023; y <= 2026; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
  const mk = (dk: string, h: number, mm: number, subtype: string, label: string): EventDraft | null => {
    if (dk < start || dk >= endKey) return null;
    const z = Math.max(-3.2, Math.min(3.2, studentT(rng, 5)));
    return {
      at: zonedToUtc(dk, h, mm).toISOString(),
      subtype,
      z,
      shock: Math.abs(z) < 0.5 ? 0 : z > 0 ? 1 : -1,
      issuerId: null,
      counterpartyId: null,
      dealRole: "none",
      guidance: "none",
      label,
      title: `${label} ${z > 0.5 ? "above" : z < -0.5 ? "below" : "near"} consensus (synthetic)`,
    };
  };
  for (const ym of months) {
    const cpi = firstTradingOnOrAfter(`${ym}-12`);
    const rs = firstTradingOnOrAfter(`${ym}-16`);
    const pce = firstTradingOnOrAfter(`${ym}-27`);
    let nfp = `${ym}-01`;
    while (weekdayOfKey(nfp) !== 5 || !isTradingDay(nfp)) nfp = addDaysToKey(nfp, 1);
    for (const e of [mk(cpi, 8, 30, "macro.cpi", "CPI"), mk(rs, 8, 30, "macro.retail_sales", "Retail Sales (MoM)"), mk(pce, 8, 30, "macro.pce", "Core PCE"), mk(nfp, 8, 30, "macro.payrolls", "Nonfarm Payrolls")]) if (e) out.push(e);
    const m = Number(ym.slice(5));
    const f = FOMC_MONTH_DAY.find(([mm]) => mm === m);
    if (f) {
      const e = mk(firstTradingOnOrAfter(`${ym}-${String(f[1]).padStart(2, "0")}`), 14, 0, "macro.fomc", "FOMC Rate Decision");
      if (e) out.push(e);
    }
  }
  return out;
}

function companyEvents(sessions: Session[], master: SecurityMaster, endKey: string, rng: Rng): EventDraft[] {
  const equities = master.securities.filter((s) => s.kind === "equity");
  const out: EventDraft[] = [];
  for (const s of sessions) {
    if (s.date < "2023-04-03" || s.date >= endKey) continue;
    const n = rng() < 0.2 ? 0 : rng() < 0.45 ? 1 : rng() < 0.75 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const subtype = weighted(rng, COMPANY_SUBTYPES);
      let issuer: Security | null = pick(rng, equities);
      let counterparty: Security | null = null;
      let z: number | null = null;
      let shock: Shock = 0;
      let dealRole: EventDraft["dealRole"] = "none";
      let guidance: EventDraft["guidance"] = "none";
      if (subtype === "regulation.drug_approval") issuer = pick(rng, equities.filter((e) => e.sector === "Healthcare"));
      if (subtype === "regulation.export_controls") issuer = pick(rng, equities.filter((e) => e.sector === "Semiconductors"));
      if (subtype === "sector.supply_shortage") issuer = pick(rng, equities.filter((e) => ["Semiconductors", "Energy", "Materials"].includes(e.sector)));
      if (subtype === "geopolitics.oil_supply") issuer = null;
      if (subtype === "earnings.report") {
        z = Math.max(-3, Math.min(3, studentT(rng, 5)));
        shock = z > 0.25 ? 1 : z < -0.25 ? -1 : 0;
        guidance = rng() < 0.25 ? (z > 0 ? "raised" : "lowered") : "none";
      } else if (subtype === "earnings.guidance") {
        guidance = rng() < 0.55 ? "raised" : "lowered";
        shock = guidance === "raised" ? 1 : -1;
      } else if (subtype === "ma.announced") {
        dealRole = "target";
        const peers = equities.filter((e) => e.id !== issuer!.id && e.sector === issuer!.sector);
        counterparty = peers.length ? pick(rng, peers) : null;
        shock = 1;
      } else if (subtype === "regulation.drug_approval") {
        shock = rng() < 0.65 ? 1 : -1;
      } else if (subtype === "filing.insider_form4") {
        shock = rng() < 0.6 ? 1 : -1;
      } else if (["geopolitics.oil_supply", "sector.supply_shortage", "company.buyback"].includes(subtype)) {
        shock = 1;
        if (subtype === "geopolitics.oil_supply") z = 0.8 + rng() * 1.6;
      } else if (["regulation.antitrust", "regulation.export_controls", "company.cyber_incident", "company.recall", "company.credit_downgrade"].includes(subtype)) {
        shock = -1;
      }
      const slot = rng();
      const [h, mm] =
        subtype.startsWith("earnings") ? (slot < 0.5 ? [7, 0] : [16, 5]) : subtype === "filing.insider_form4" ? [16 + Math.floor(rng() * 2), 15] : [9 + Math.floor(slot * 6.4), Math.floor(rng() * 60)];
      out.push({
        at: zonedToUtc(s.date, h, mm).toISOString(),
        subtype,
        z,
        shock,
        issuerId: issuer?.id ?? null,
        counterpartyId: counterparty?.id ?? null,
        dealRole,
        guidance,
        label: null,
        title: `${issuer?.name ?? "Market"}: ${subtype.split(".")[1]!.replace(/_/g, " ")} (synthetic)`,
      });
    }
  }
  return out;
}

export function draftToEvent(d: EventDraft, master: SecurityMaster, regime: Regime, isCurrent: boolean, idx: number): SyntheticEvent {
  let bucket = "na";
  if (d.subtype.startsWith("macro.")) bucket = surpriseBucket(d.z);
  else if (d.subtype.startsWith("earnings.")) bucket = d.z !== null ? surpriseBucket(d.z) : d.guidance === "raised" ? "guide_up" : d.guidance === "lowered" ? "guide_down" : "na";
  else if (d.subtype.startsWith("ma.")) bucket = d.dealRole === "acquirer" ? "acquirer" : "target";
  else if (d.subtype === "regulation.drug_approval") bucket = d.shock > 0 ? "approve" : "reject";
  else if (d.subtype === "filing.insider_form4") bucket = d.shock > 0 ? "insider_buy" : "insider_sell";
  const mech = buildMechanism({
    subtype: d.subtype,
    shock: d.shock,
    magnitudeZ: d.z,
    bucket,
    issuer: d.issuerId ? master.byId(d.issuerId) : null,
    counterparty: d.counterpartyId ? master.byId(d.counterpartyId) : null,
    dealRole: d.dealRole,
    guidance: d.guidance,
    indicatorLabel: d.label,
    master,
  });
  const exposures: SyntheticExposure[] = [];
  const seen = new Set<string>();
  for (const e of mech.exposures) {
    if (seen.has(e.security.id)) continue;
    seen.add(e.security.id);
    const fl = e.security.factorLoadings ?? {};
    const loadingAbs = e.relationship === "rate_sensitivity" ? Math.abs(fl.ratesPer100bp ?? 0) : e.relationship === "commodity_sensitivity" ? Math.abs(fl.oilPer10pct ?? 0) : e.relationship === "fx_sensitivity" ? Math.abs(fl.usdPer5pct ?? 0) : 1;
    exposures.push({ securityId: e.security.id, channelKey: e.channelKey, sign: e.sign, relationship: e.relationship, yTrue: trueEffectY(d.subtype, e.channelKey, d.z, d.shock, loadingAbs) });
  }
  return {
    id: `hx_${idx.toString(36)}_${hash32(d.at + d.subtype + (d.issuerId ?? "")).toString(36)}`,
    at: d.at,
    subtype: d.subtype,
    bucket,
    shock: d.shock,
    magnitudeZ: d.z,
    issuerId: d.issuerId,
    title: d.title,
    exposures,
    regime,
    isCurrent,
  };
}

// ---------------------------------------------------------------------------------------------

interface Increments {
  /** [session][slot] with slot 0 = overnight, 1..13 = half-hours (unused slots on early-close days). */
  market: Float64Array;
  rates: Float64Array; // bp
  oil: Float64Array; // %
  usd: Float64Array; // %
}

const SLOTS = 1 + HALF_HOURS;

function slotWeights(s: Session): number[] {
  const intradaySlots = Math.round(s.minutes / 30);
  const w = new Array<number>(SLOTS).fill(0);
  w[0] = 0.25;
  for (let i = 1; i <= intradaySlots; i++) w[i] = 0.75 / intradaySlots;
  return w;
}

/** Locate the increment slot an instant falls into: [sessionIndex, slot]. */
export function slotOf(sessions: Session[], at: Date, indexByDate: Map<string, number>): [number, number] | null {
  const dk = dateKeyOf(at);
  const s = sessionOn(dk);
  const t = at.getTime();
  if (s && t >= s.open.getTime() && t < s.close.getTime()) {
    const slot = 1 + Math.floor((t - s.open.getTime()) / (30 * 60000));
    const idx = indexByDate.get(s.date);
    return idx === undefined ? null : [idx, slot];
  }
  // Outside regular hours → the next session's opening (overnight) increment.
  const target = s && t < s.open.getTime() ? s.date : nextTradingDay(dk);
  const idx = indexByDate.get(target);
  return idx === undefined ? null : [idx, 0];
}

export function generateMarket(args: {
  master: SecurityMaster;
  endKey: string;
  endInstant: Date;
  currentEvents: SyntheticEvent[];
  seed?: number;
}): MarketData {
  const rng = mulberry32(args.seed ?? 20261014);
  const sessions = tradingSessions(HISTORY_START, args.endKey);
  const indexByDate = new Map(sessions.map((s, i) => [s.date, i] as const));
  const N = sessions.length;

  // Regimes (Markov) and factor increments.
  const regimes: Regime[] = [];
  let reg: Regime = "normal";
  const P: Record<Regime, Array<[Regime, number]>> = {
    calm: [["calm", 0.975], ["normal", 0.025]],
    normal: [["normal", 0.965], ["calm", 0.02], ["stressed", 0.015]],
    stressed: [["stressed", 0.93], ["normal", 0.07]],
  };
  const inc: Increments = { market: new Float64Array(N * SLOTS), rates: new Float64Array(N * SLOTS), oil: new Float64Array(N * SLOTS), usd: new Float64Array(N * SLOTS) };
  for (let i = 0; i < N; i++) {
    reg = weighted(rng, P[reg]);
    regimes.push(reg);
    const w = slotWeights(sessions[i]!);
    const volM = REGIME_VOL[reg];
    for (let k = 0; k < SLOTS; k++) {
      if (!w[k]) continue;
      const sq = Math.sqrt(w[k]!);
      inc.market[i * SLOTS + k] = 0.00035 * w[k]! + volM * sq * heavyTail(rng);
      inc.rates[i * SLOTS + k] = 5.5 * sq * normal(rng);
      inc.oil[i * SLOTS + k] = 1.9 * sq * normal(rng);
      inc.usd[i * SLOTS + k] = 0.38 * sq * normal(rng);
    }
  }

  // Event jumps per security: Map<securityId, Map<flatSlot, logIncrement>>
  const jumps = new Map<string, Map<number, number>>();
  const addJump = (sid: string, flat: number, v: number) => {
    let m = jumps.get(sid);
    if (!m) jumps.set(sid, (m = new Map()));
    m.set(flat, (m.get(flat) ?? 0) + v);
  };
  const regimeAt = (at: string) => regimes[indexByDate.get(dateKeyOf(new Date(at))) ?? 0] ?? "normal";

  // Historical events (generated here so jumps land in the same paths).
  const endHistKey = addDaysToKey(args.endKey, -7);
  const drafts = [...scheduleMacro(sessions, endHistKey, rng), ...companyEvents(sessions, args.master, endHistKey, rng)].sort((a, b) => a.at.localeCompare(b.at));
  const history = drafts.map((d, i) => draftToEvent(d, args.master, regimeAt(d.at), false, i));
  const all = [...history, ...args.currentEvents];

  for (const ev of all) {
    const loc = slotOf(sessions, new Date(ev.at), indexByDate);
    if (!loc) continue;
    const [si, slot] = loc;
    const sess = sessions[si]!;
    const lastSlot = Math.round(sess.minutes / 30);
    for (const ex of ev.exposures) {
      const spec = DEMO_SPECS.get(ex.securityId);
      if (!spec) continue;
      const noiseRng = mulberry32(hash32(`${ev.id}|${ex.securityId}`));
      const jumpPct = (ex.yTrue + 0.35 * studentT(noiseRng, 4)) * spec.sigma * 100;
      const j = jumpPct / 100;
      if (slot === 0) {
        addJump(ex.securityId, si * SLOTS, 0.85 * j);
        addJump(ex.securityId, si * SLOTS + 1, 0.15 * j);
      } else {
        addJump(ex.securityId, si * SLOTS + slot, 0.65 * j);
        const rest = lastSlot - slot;
        for (let k = slot + 1; k <= lastSlot; k++) addJump(ex.securityId, si * SLOTS + k, (0.35 * j) / Math.max(1, rest));
        if (rest <= 0) addJump(ex.securityId, (si + 1) * SLOTS, 0.35 * j);
      }
      // Post-event drift over the next four sessions (5-session horizon).
      for (let d = 1; d <= 4; d++) if (si + d < N) addJump(ex.securityId, (si + d) * SLOTS, (0.2 * j) / 4);
    }
  }

  // Price paths.
  const daily = new Map<string, PriceBar[]>();
  const intraday = new Map<string, PriceBar[]>();
  const firstIntraday = Math.max(0, N - INTRADAY_SESSIONS);
  const endMs = args.endInstant.getTime();
  // Timestamps are shared across securities (one string per session slot).
  const closeIso = sessions.map((s) => s.close.toISOString());
  const slotIso: string[][] = sessions.map((s, i) =>
    i < firstIntraday ? [] : Array.from({ length: SLOTS }, (_, k) => new Date(s.open.getTime() + k * 30 * 60000).toISOString()),
  );
  for (const sec of args.master.securities) {
    const spec = DEMO_SPECS.get(sec.id);
    if (!spec) continue;
    const r = mulberry32(hash32(`path|${sec.id}`));
    const fl = sec.factorLoadings ?? {};
    // Daily factor contributions (decimal): rates 5.5bp/day, oil 1.9%/day, USD 0.38%/day.
    const factorVar = (((fl.ratesPer100bp ?? 0) * 0.055) / 100) ** 2 + (((fl.oilPer10pct ?? 0) * 0.19) / 100) ** 2 + (((fl.usdPer5pct ?? 0) * 0.076) / 100) ** 2;
    const sysVar = (spec.beta * REGIME_VOL.normal) ** 2 + factorVar;
    const idio = Math.sqrt(Math.max(spec.sigma ** 2 - sysVar, (0.35 * spec.sigma) ** 2));
    const jm = jumps.get(sec.id);
    let logP = Math.log(spec.start);
    const dBars: PriceBar[] = [];
    const iBars: PriceBar[] = [];
    const baseVol = 2e6 * (spec.kind === "equity" ? 1 : 3) * (spec.cap === "mega" ? 4 : spec.cap === "large" ? 2 : 1);
    for (let i = 0; i < N; i++) {
      const s = sessions[i]!;
      if (s.open.getTime() > endMs) break;
      const w = slotWeights(s);
      const slots = Math.round(s.minutes / 30);
      const prevClose = Math.exp(logP);
      let hi = prevClose;
      let lo = prevClose;
      let open = prevClose;
      let dayAbs = 0;
      let lastClose = prevClose;
      let partial = false;
      for (let k = 0; k <= slots; k++) {
        const flat = i * SLOTS + k;
        const sq = Math.sqrt(w[k]!);
        let x =
          spec.beta * inc.market[flat]! +
          ((fl.ratesPer100bp ?? 0) * inc.rates[flat]!) / 10000 +
          ((fl.oilPer10pct ?? 0) * inc.oil[flat]!) / 1000 +
          ((fl.usdPer5pct ?? 0) * inc.usd[flat]!) / 500 +
          idio * sq * heavyTail(r);
        if (sec.ticker === "VOLX") {
          const target = Math.log(regimes[i] === "stressed" ? 28 : regimes[i] === "calm" ? 13 : 17);
          x += -0.08 * w[k]! * (logP - target);
        }
        const jv = jm?.get(flat);
        if (jv) {
          x += jv;
          dayAbs += Math.abs(jv);
        }
        logP += x;
        const p = Math.exp(logP);
        if (k === 0) {
          open = p;
          hi = Math.max(prevClose, p);
          lo = Math.min(prevClose, p);
          continue;
        }
        const barEnd = s.open.getTime() + k * 30 * 60000;
        if (barEnd > endMs) {
          // Stop the path at the demo clock: no bar exists after "now".
          logP -= x;
          partial = true;
          break;
        }
        hi = Math.max(hi, p);
        lo = Math.min(lo, p);
        lastClose = p;
        if (i >= firstIntraday) {
          const prev = iBars.length ? iBars[iBars.length - 1]!.c : open;
          iBars.push({ t: slotIso[i]![k]!, o: round(prev), h: round(Math.max(prev, p) * (1 + 0.0007 * r())), l: round(Math.min(prev, p) * (1 - 0.0007 * r())), c: round(p), v: Math.round((baseVol / slots) * (k === 1 || k === slots ? 1.8 : 0.8) * (1 + 40 * Math.abs(x))) });
        }
      }
      if (partial) break;
      dBars.push({ t: closeIso[i]!, o: round(open), h: round(hi), l: round(lo), c: round(lastClose), v: Math.round(baseVol * Math.exp(0.25 * normal(r)) * (1 + (dayAbs / spec.sigma) * 1.5)) });
    }
    daily.set(sec.id, dBars);
    intraday.set(sec.id, iBars);
  }
  return { sessions, daily, intraday, regimeByDate: new Map(sessions.map((s, i) => [s.date, regimes[i]!] as const)), history };
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
