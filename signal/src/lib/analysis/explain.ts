/**
 * Concise explanation generation from verified inputs only. Templates are deterministic; numeric
 * values never appear in prose (they are rendered from forecast/fact objects by the UI).
 */
import type { Exposure, MacroSurprise, VerifiedFact } from "@/lib/domain/types";
import type { RawRecord } from "@/lib/ingestion/types";
import { checkBottomLine, checkProse } from "./editorial";
import { fmtNum } from "./format";
import type { MechanismContext, MechanismResult } from "./mechanisms";

export interface ExplanationInputs {
  ctx: MechanismContext;
  mech: MechanismResult;
  exposures: Exposure[];
  macro: MacroSurprise | null;
  primary: RawRecord;
  evidenceIdByProviderId: Map<string, string>;
}

export interface Explanation {
  bottomLine: string;
  whyItMatters: string;
  facts: Array<{ text: string; evidenceId: string; label: VerifiedFact["label"] }>;
  editorialIssues: string[];
}

const dir = (shock: number, up: string, down: string, flat: string) => (shock > 0 ? up : shock < 0 ? down : flat);

function bottomLineFor(inp: ExplanationInputs): string {
  const { ctx, mech } = inp;
  const issuer = ctx.issuer?.name ?? "The company";
  const ind = ctx.indicatorLabel ?? "The release";
  switch (mech.family) {
    case "macro_inflation":
      if (inp.macro && inp.macro.surprise === null) return `${ind} was released without a licensed consensus, so its surprise is unmeasured and the rate channel stays unscored for now.`;
      return ctx.shock === 0
        ? `${ind} landed close to consensus, leaving the expected rate path and duration-sensitive assets largely unchanged for now.`
        : `${ind} came in ${dir(ctx.shock, "above", "below", "near")} consensus, ${dir(ctx.shock, "adding upward pressure on yields and weighing on", "easing pressure on yields and supporting", "")} rate-sensitive, long-duration valuations.`;
    case "macro_policy":
      return `The policy decision read ${dir(ctx.shock, "more hawkish", "more dovish", "as expected")} than priced, ${dir(ctx.shock, "lifting real yields and pressuring", "lowering real yields and supporting", "leaving")} long-duration assets ${ctx.shock === 0 ? "little changed" : "across the curve"}.`;
    case "macro_growth":
      if (inp.macro && inp.macro.surprise === null) return `${ind} was released without a licensed consensus, so its surprise is unmeasured and the growth and rate channels stay unscored.`;
      return ctx.shock === 0
        ? `${ind} offered little surprise versus expectations, so growth and policy expectations, and the equity channels tied to them, stay broadly unchanged.`
        : `${ind} came in ${dir(ctx.shock, "stronger", "weaker", "")} than consensus, ${dir(ctx.shock, "lifting growth hopes while trimming", "denting growth hopes while raising", "")} rate-cut odds, so equity effects compete across sectors.`;
    case "commodity_oil":
      return `A supply disruption is tightening the crude market, which tends to help upstream producers and squeeze fuel-intensive transport margins in the near term.`;
    case "corporate_deal":
      return `${issuer} is party to an announced acquisition; the target should trade toward offer terms while the acquirer weighs synergies against the premium.`;
    case "issuer_earnings":
      if (ctx.guidance === "reaffirmed" && ctx.shock === 0) return `${issuer} reaffirmed its outlook, so the read-through to estimates and documented peers looks limited absent new detail.`;
      if (ctx.shock === 0) return `${issuer} reported results broadly in line with expectations, so the read-through to estimates and documented peers looks limited for now.`;
      if (ctx.subtype === "earnings.guidance" && (ctx.guidance === "raised" || ctx.guidance === "lowered")) {
        return `${issuer} ${ctx.guidance} its outlook, resetting near-term estimates with possible read-through to documented peers and suppliers.`;
      }
      return `${issuer} ${dir(ctx.shock, "beat expectations", "fell short of expectations", "")}${ctx.guidance === "raised" || ctx.guidance === "lowered" ? ` and ${ctx.guidance} guidance` : ""}, resetting near-term estimates with possible read-through to documented peers and suppliers.`;
    case "issuer_regulatory":
      return `A regulatory decision affecting ${issuer} ${dir(ctx.shock, "opens a revenue path", "removes or delays a revenue path", "changes its outlook")}, with second-order effects on documented counterparties.`;
    case "sector_supply":
      return `A supply shortage centred on ${issuer} supports producer pricing power while raising input costs for documented customers further down the chain.`;
    case "issuer_capital_return":
      return `${issuer} announced a capital return program, which may support the shares through reduced share count and a signal of management confidence.`;
    case "issuer_adverse":
      return `${issuer} disclosed an adverse event that may raise costs or liabilities, pressuring expected cash flows until the scope becomes clearer.`;
    case "issuer_price_war":
      return `${issuer} is cutting prices, which may pressure margins across documented competitors if rivals match the move.`;
    default:
      if (!ctx.issuer) return "A report without a verifiable company or asset link was received; no defensible exposure can be named, so it stays informational.";
      if (ctx.subtype === "company.leadership_change") return `${issuer} disclosed a leadership change; the effect depends on succession details, so the directional read stays tentative for now.`;
      if (ctx.subtype === "filing.insider_form4") return `An insider transaction at ${issuer} was reported to regulators; such filings carry modest information about management's view of value.`;
      return `A report concerning ${issuer} carries information whose market effect depends on details not yet confirmed, so the directional read stays tentative.`;
  }
}

function whyFor(inp: ExplanationInputs): string {
  const { mech, exposures } = inp;
  const direct = exposures.filter((e) => e.directness === "direct").map((e) => e.ticker);
  const second = exposures.filter((e) => e.directness === "second_order").map((e) => e.ticker);
  const chain = mech.transmission.join(" → ");
  const who = [direct.length ? `Directly exposed: ${direct.join(", ")}.` : "", second.length ? `Second-order: ${second.join(", ")}.` : ""].filter(Boolean).join(" ");
  return `${chain}. ${who}`.trim();
}


/** Facts built strictly from provided fields; each cites its evidence ID. */
function factsFor(inp: ExplanationInputs): Explanation["facts"] {
  const { primary } = inp;
  const ev = inp.evidenceIdByProviderId.get(primary.providerId)!;
  const out: Explanation["facts"] = [];
  const m = primary.structured?.macro;
  if (m) {
    out.push({
      text: `${m.indicator} (${m.period}) actual ${fmtNum(m.actual, m.unit)}${m.consensus ? ` vs consensus ${fmtNum(m.consensus.value, m.consensus.unit)} (${m.consensus.source})` : "; no licensed consensus"}.`,
      evidenceId: ev,
      label: "confirmed_fact",
    });
    if (m.prior !== null) out.push({ text: `Prior reading ${fmtNum(m.prior, m.unit)}${m.revisedPrior !== null && m.revisedPrior !== m.prior ? `, revised to ${fmtNum(m.revisedPrior, m.unit)}` : ""}.`, evidenceId: ev, label: "confirmed_fact" });
  }
  const e = primary.structured?.earnings;
  if (e) {
    if (e.epsActual !== null && e.epsConsensus !== null) out.push({ text: `EPS $${e.epsActual} vs consensus $${e.epsConsensus} (${e.consensusSource ?? "consensus source"}).`, evidenceId: ev, label: "confirmed_fact" });
    if (e.guidance !== "none") out.push({ text: `Full-year guidance ${e.guidance}.`, evidenceId: ev, label: "confirmed_fact" });
  }
  const f = primary.structured?.filing;
  if (f) out.push({ text: `Form ${f.form}${f.items.length ? ` (Items ${f.items.join(", ")})` : ""} accepted by the SEC${f.isAmendment ? " as an amendment" : ""}.`, evidenceId: ev, label: "confirmed_fact" });
  const d = primary.structured?.deal;
  if (d) {
    if (d.premiumPct !== null) out.push({ text: `Offer represents a ${d.premiumPct}% premium per the announcement.`, evidenceId: ev, label: "confirmed_fact" });
  }
  if (!out.length) out.push({ text: primary.title.endsWith(".") ? primary.title : `${primary.title}.`, evidenceId: ev, label: "confirmed_fact" });
  return out.slice(0, 3);
}

export function explain(inp: ExplanationInputs): Explanation {
  let bottomLine = bottomLineFor(inp).replace(/\s+/g, " ").replace(/ ,/g, ",").trim();
  const issues: string[] = [];
  const bl = checkBottomLine(bottomLine);
  if (!bl.ok) {
    issues.push(...bl.issues);
    bottomLine = "A newly verified event may change expectations for the exposed assets below; the mechanism and its uncertainty are detailed in the dossier.";
  }
  const whyItMatters = whyFor(inp);
  const wp = checkProse(whyItMatters);
  if (!wp.ok) issues.push(...wp.issues);
  return { bottomLine, whyItMatters, facts: factsFor(inp), editorialIssues: issues };
}

/** Plain-text rendering of a structured payload, used as the verifiable source text. */
export function structuredSourceText(r: RawRecord): string {
  const parts = [r.title, r.excerpt];
  const m = r.structured?.macro;
  if (m) parts.push(`${m.indicator} (${m.period}) actual ${fmtNum(m.actual, m.unit)}${m.consensus ? ` vs consensus ${fmtNum(m.consensus.value, m.consensus.unit)} (${m.consensus.source})` : "; no licensed consensus"}. Prior reading ${m.prior === null ? "n/a" : fmtNum(m.prior, m.unit)}${m.revisedPrior !== null && m.revisedPrior !== m.prior ? `, revised to ${fmtNum(m.revisedPrior, m.unit)}` : ""}.`);
  const e = r.structured?.earnings;
  if (e) parts.push(`EPS $${e.epsActual} vs consensus $${e.epsConsensus} (${e.consensusSource ?? "consensus source"}). Full-year guidance ${e.guidance}.`);
  const f = r.structured?.filing;
  if (f) parts.push(`Form ${f.form}${f.items.length ? ` (Items ${f.items.join(", ")})` : ""} accepted by the SEC${f.isAmendment ? " as an amendment" : ""}.`);
  const d = r.structured?.deal;
  if (d && d.premiumPct !== null) parts.push(`Offer represents a ${d.premiumPct}% premium per the announcement.`);
  return parts.join(" ");
}
