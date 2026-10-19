/**
 * Transmission-mechanism templates. Each event family maps to an explainable directed graph:
 * event → macro variables / channels → sectors → securities, with sign, directness, lag and
 * uncertainty on every edge. Exposures are only selected through documented links (issuer
 * identity, documented relationships, index membership, documented factor sensitivities);
 * anything else is labelled `hypothesized`.
 */
import type { Directness, MechanismEdge, MechanismGraph, MechanismNode, Relationship, Security, Severity, Sign } from "@/lib/domain/types";
import { hashHex } from "@/lib/quant/stats";
import type { SecurityMaster } from "./securityMaster";

export type Shock = 1 | -1 | 0;

export interface MechanismContext {
  subtype: string;
  shock: Shock;
  /** Standardized magnitude when measured (macro/earnings surprise z); null if not measured. */
  magnitudeZ: number | null;
  bucket: string;
  issuer: Security | null;
  counterparty: Security | null;
  dealRole: "target" | "acquirer" | "none";
  guidance: "raised" | "lowered" | "reaffirmed" | "initiated" | "withdrawn" | "none";
  indicatorLabel: string | null;
  master: SecurityMaster;
}

export interface ExposureCandidate {
  security: Security;
  relationship: Relationship;
  directness: Directness;
  sign: Sign;
  severity: Severity;
  mechanism: string;
  linkage: string[];
  /** Documentary support for the linkage (becomes Evidence of kind "data"). */
  support: Array<{ text: string; path: string | null }>;
  hypothesized: boolean;
  channelKey: string;
}

export interface MechanismResult {
  family: string;
  label: string;
  transmission: string[];
  graph: MechanismGraph;
  exposures: ExposureCandidate[];
  counterMechanisms: string[];
  invalidation: string[];
  openQuestions: string[];
  scenario: { upside: string; downside: string };
}

const arrow = (s: Shock) => (s > 0 ? "↑" : s < 0 ? "↓" : "?");
const signOf = (x: number): Sign => (x > 0 ? "positive" : x < 0 ? "negative" : "mixed");
const flip = (s: Sign): Sign => (s === "positive" ? "negative" : s === "negative" ? "positive" : "mixed");

function severityFrom(abs: number, hi: number, mid: number): Severity {
  return abs >= hi ? "high" : abs >= mid ? "medium" : "low";
}

class GraphBuilder {
  nodes: MechanismNode[] = [];
  edges: MechanismEdge[] = [];
  node(id: string, kind: MechanismNode["kind"], label: string, securityId?: string): string {
    if (!this.nodes.some((n) => n.id === id)) this.nodes.push({ id, kind, label, securityId, observed: null });
    return id;
  }
  edge(from: string, to: string, e: Omit<MechanismEdge, "id" | "from" | "to" | "evidenceIds"> & { evidenceIds?: string[] }): void {
    this.edges.push({ id: `e_${hashHex(`${from}>${to}`)}`, from, to, evidenceIds: e.evidenceIds ?? [], ...e });
  }
  build(): MechanismGraph {
    return { nodes: this.nodes, edges: this.edges };
  }
}

function factorExposures(
  ctx: MechanismContext,
  factor: "ratesPer100bp" | "oilPer10pct" | "usdPer5pct",
  shockSign: Shock,
  relationship: Relationship,
  channelLabel: string,
  opts: { min: number; limit: number; preferProxies: boolean; hi: number; mid: number },
): ExposureCandidate[] {
  const unit = factor === "ratesPer100bp" ? "+100bp" : factor === "oilPer10pct" ? "+10% crude" : "+5% USD";
  const cands = ctx.master.securities
    .filter((s) => s.factorLoadings && Math.abs(s.factorLoadings[factor] ?? 0) >= opts.min)
    .map((s) => ({ s, l: s.factorLoadings![factor]! }))
    .sort((a, b) => {
      const pa = opts.preferProxies && a.s.kind !== "equity" ? 1 : 0;
      const pb = opts.preferProxies && b.s.kind !== "equity" ? 1 : 0;
      return pb - pa || Math.abs(b.l) - Math.abs(a.l);
    })
    .slice(0, opts.limit);
  return cands.map(({ s, l }) => {
    const sign = shockSign === 0 ? "mixed" : signOf(l * shockSign);
    return {
      security: s,
      relationship,
      directness: "second_order" as const,
      sign,
      severity: severityFrom(Math.abs(l), opts.hi, opts.mid),
      mechanism: `${channelLabel}: ${l > 0 ? "+" : ""}${l.toFixed(1)}% per ${unit} (documented sensitivity)`,
      linkage: [`${channelLabel} ${arrow(shockSign)}`, `${s.ticker} sensitivity ${l > 0 ? "+" : ""}${l.toFixed(1)}% per ${unit}`],
      support: [{ text: `${s.ticker} factor loading ${factor} = ${l}${s.loadingsVerified === false ? " (approximate, unverified)" : ""}`, path: `/ticker/${s.ticker}#exposures` }],
      hypothesized: s.loadingsVerified === false,
      channelKey: `${relationship}:${sign}`,
    };
  });
}

function issuerExposure(ctx: MechanismContext, sign: Sign, severity: Severity, mechanism: string, linkage: string[]): ExposureCandidate[] {
  if (!ctx.issuer) return [];
  return [
    {
      security: ctx.issuer,
      relationship: "direct",
      directness: "direct",
      sign,
      severity,
      mechanism,
      linkage: [`Issuer identified in source: ${ctx.issuer.name}`, ...linkage],
      support: [{ text: `Issuer of the disclosed event: ${ctx.issuer.name} (${ctx.issuer.ticker})`, path: `/ticker/${ctx.issuer.ticker}` }],
      hypothesized: false,
      channelKey: `direct:${sign}`,
    },
  ];
}

function relationshipExposures(ctx: MechanismContext, kind: "supplier" | "customer" | "competitor", sign: Sign, why: string, limit = 2): ExposureCandidate[] {
  if (!ctx.issuer) return [];
  // relationsOf(issuer) lists counterparties: kind "supplier" means toId supplies the issuer.
  return ctx.master
    .relationsOf(ctx.issuer.id)
    .filter((r) => r.kind === kind)
    .slice(0, limit)
    .flatMap((r) => {
      const s = ctx.master.byId(r.toId);
      if (!s) return [];
      return [
        {
          security: s,
          relationship: kind,
          directness: "second_order" as const,
          sign,
          severity: "low" as Severity,
          mechanism: why,
          linkage: [`${ctx.issuer!.ticker} event`, `${s.ticker} is a documented ${kind} of ${ctx.issuer!.ticker}`, r.evidence],
          support: [{ text: r.evidence, path: r.evidencePath }],
          hypothesized: kind === "competitor",
          channelKey: `${kind}:${sign}`,
        },
      ];
    });
}

function indexExposure(ctx: MechanismContext, sign: Sign): ExposureCandidate[] {
  if (!ctx.issuer) return [];
  const m = ctx.master.etfsContaining(ctx.issuer.id).filter((x) => x.weight >= 0.04)[0];
  if (!m) return [];
  const etf = ctx.master.byId(m.etfId);
  if (!etf) return [];
  return [
    {
      security: etf,
      relationship: "index",
      directness: "second_order",
      sign,
      severity: "low",
      mechanism: `${ctx.issuer.ticker} is ${(m.weight * 100).toFixed(1)}% of ${etf.ticker}`,
      linkage: [`${ctx.issuer.ticker} event`, `${etf.ticker} holds ${ctx.issuer.ticker} at ${(m.weight * 100).toFixed(1)}% weight (${m.source}, as of ${m.asOf})`],
      support: [{ text: `${etf.ticker} holdings: ${ctx.issuer.ticker} ${(m.weight * 100).toFixed(1)}% (${m.source}, ${m.asOf})`, path: `/ticker/${etf.ticker}` }],
      hypothesized: false,
      channelKey: `index:${sign}`,
    },
  ];
}

function benchmark(ctx: MechanismContext): Security | null {
  return ctx.master.benchmark();
}

// ---------------------------------------------------------------------------------------------

function ratesFamily(ctx: MechanismContext, kind: "inflation" | "policy"): MechanismResult {
  const s = ctx.shock;
  const g = new GraphBuilder();
  const ev = g.node("event", "event", ctx.indicatorLabel ?? (kind === "inflation" ? "Inflation print" : "Policy decision"));
  const path = g.node("policy", "macro", "Expected policy path");
  const yields = g.node("yields", "macro", "Real yields");
  const dur = g.node("duration", "channel", "Long-duration valuations");
  const usd = g.node("usd", "macro", "US dollar");
  const unc = s === 0 ? "high" : "medium";
  if (kind === "inflation") g.edge(ev, path, { sign: s > 0 ? "positive" : s < 0 ? "negative" : "mixed", relationship: "rate_sensitivity", directness: "direct", lag: "minutes", uncertainty: unc, rationale: "Hotter inflation raises the expected policy-rate path", hypothesized: false });
  else g.edge(ev, path, { sign: s > 0 ? "positive" : s < 0 ? "negative" : "mixed", relationship: "rate_sensitivity", directness: "direct", lag: "minutes", uncertainty: unc, rationale: "Hawkish surprise shifts the expected policy path", hypothesized: false });
  g.edge(path, yields, { sign: "positive", relationship: "rate_sensitivity", directness: "second_order", lag: "minutes", uncertainty: "medium", rationale: "Higher expected policy rates lift real yields", hypothesized: false });
  g.edge(yields, dur, { sign: "negative", relationship: "rate_sensitivity", directness: "second_order", lag: "hours", uncertainty: "medium", rationale: "Higher discount rates compress long-duration multiples", hypothesized: false });
  g.edge(path, usd, { sign: "positive", relationship: "fx_sensitivity", directness: "second_order", lag: "minutes", uncertainty: "high", rationale: "Wider rate differentials tend to support the dollar", hypothesized: true });

  const exposures = [
    ...factorExposures(ctx, "ratesPer100bp", s, "rate_sensitivity", "Real yields", { min: 4, limit: 3, preferProxies: true, hi: 12, mid: 6 }),
    ...factorExposures(ctx, "usdPer5pct", s, "fx_sensitivity", "Dollar", { min: 3, limit: 1, preferProxies: true, hi: 5, mid: 3 }).map((e) => ({ ...e, hypothesized: true })),
  ];
  for (const e of exposures) {
    const n = g.node(`sec_${e.security.ticker}`, "security", e.security.ticker, e.security.id);
    g.edge(e.relationship === "fx_sensitivity" ? usd : dur, n, { sign: e.sign, relationship: e.relationship, directness: "second_order", lag: "hours", uncertainty: "medium", rationale: e.mechanism, hypothesized: e.hypothesized });
  }
  const label = kind === "inflation" ? "inflation" : "policy";
  return {
    family: kind === "inflation" ? "macro_inflation" : "macro_policy",
    label: kind === "inflation" ? "Inflation surprise" : "Policy surprise",
    transmission:
      s === 0
        ? [`${ctx.indicatorLabel ?? "Release"} in line or surprise unmeasured`, "Policy path unchanged", "Limited repricing expected"]
        : kind === "inflation"
          ? [`Inflation ${s > 0 ? "above" : "below"} consensus`, `Expected policy path ${arrow(s)}`, `Real yields ${arrow(s)}`, `Long-duration multiples ${arrow((s * -1) as Shock)}`]
          : [`Policy ${s > 0 ? "more hawkish" : "more dovish"} than expected`, `Real yields ${arrow(s)}`, `Long-duration multiples ${arrow((s * -1) as Shock)}`],
    graph: g.build(),
    exposures,
    counterMechanisms: [
      `A ${label} surprise can also shift growth expectations, partly offsetting the rate channel for cyclicals.`,
      "If longer-dated yields fall (curve flattening), long-duration assets may not reprice as the rate channel implies.",
    ],
    invalidation: [
      `2-year and 10-year yields move ${s > 0 ? "lower" : "higher"} through the session`,
      "Core components contradict the headline surprise",
      "Policymaker commentary explicitly discounts the print",
    ],
    openQuestions: ["Is the surprise concentrated in volatile components?", "How much of the move was positioned for before the release?"],
    scenario: {
      upside: `Yields ${s > 0 ? "retrace" : "extend lower"} as details soften the headline; duration assets recover.`,
      downside: `Yields ${s > 0 ? "extend higher" : "rebound"} on follow-through repricing of the policy path.`,
    },
  };
}

function growthFamily(ctx: MechanismContext, inverted: boolean): MechanismResult {
  const s = (inverted ? -ctx.shock : ctx.shock) as Shock;
  const g = new GraphBuilder();
  const ev = g.node("event", "event", ctx.indicatorLabel ?? "Activity data");
  const growth = g.node("growth", "macro", "Growth expectations");
  const policy = g.node("policy", "macro", "Rate-cut odds");
  const cyc = g.node("cyclicals", "channel", "Cyclical earnings");
  const dur = g.node("duration", "channel", "Long-duration valuations");
  g.edge(ev, growth, { sign: signOf(s), relationship: "hypothesized", directness: "direct", lag: "minutes", uncertainty: "medium", rationale: "Stronger activity raises expected growth", hypothesized: false });
  g.edge(ev, policy, { sign: flip(signOf(s)), relationship: "rate_sensitivity", directness: "direct", lag: "minutes", uncertainty: "medium", rationale: "Stronger activity lowers the odds of near-term cuts", hypothesized: false });
  g.edge(growth, cyc, { sign: "positive", relationship: "sector", directness: "second_order", lag: "days", uncertainty: "high", rationale: "Cyclical revenue tracks growth", hypothesized: true });
  g.edge(policy, dur, { sign: "positive", relationship: "rate_sensitivity", directness: "second_order", lag: "hours", uncertainty: "medium", rationale: "Fewer cuts → higher yields → lower duration valuations", hypothesized: false });
  const exposures = [
    ...factorExposures(ctx, "ratesPer100bp", s, "rate_sensitivity", "Real yields", { min: 8, limit: 2, preferProxies: true, hi: 12, mid: 6 }),
  ];
  const bench = benchmark(ctx);
  if (bench) {
    exposures.push({
      security: bench,
      relationship: "index",
      directness: "second_order",
      sign: "mixed",
      severity: "low",
      mechanism: "Growth channel and rate channel pull in opposite directions",
      linkage: ["Growth expectations vs. rate-cut odds", `${bench.ticker} is the broad-market proxy`],
      support: [{ text: `${bench.ticker}: broad-market benchmark in the security master`, path: `/ticker/${bench.ticker}` }],
      hypothesized: true,
      channelKey: "index:mixed",
    });
  }
  for (const e of exposures) {
    const n = g.node(`sec_${e.security.ticker}`, "security", e.security.ticker, e.security.id);
    g.edge(e.relationship === "index" ? cyc : dur, n, { sign: e.sign, relationship: e.relationship, directness: "second_order", lag: "hours", uncertainty: e.sign === "mixed" ? "high" : "medium", rationale: e.mechanism, hypothesized: e.hypothesized });
  }
  return {
    family: "macro_growth",
    label: "Activity surprise",
    transmission:
      s === 0
        ? [`${ctx.indicatorLabel ?? "Release"} near consensus or unmeasured`, "Growth and policy expectations little changed"]
        : [`Activity ${s > 0 ? "stronger" : "weaker"} than consensus`, `Growth expectations ${arrow(s)}`, `Rate-cut odds ${arrow((s * -1) as Shock)}`, "Equity impact: competing channels"],
    graph: g.build(),
    exposures,
    counterMechanisms: [
      "Good-news-is-bad-news: stronger data can hurt equities via higher yields even as it lifts earnings expectations.",
      "Revisions to prior months can reverse the headline signal.",
    ],
    invalidation: ["Prior-month revisions offset the headline", `Front-end yields move ${s > 0 ? "lower" : "higher"}`],
    openQuestions: ["Do wage and hours components confirm the headline?", "Is the market trading growth or rates today?"],
    scenario: {
      upside: "Growth channel dominates: cyclicals and small caps outperform despite firmer yields.",
      downside: "Rate channel dominates: duration-heavy assets lag as cut odds fall.",
    },
  };
}

function oilFamily(ctx: MechanismContext): MechanismResult {
  const s = ctx.shock === 0 ? 1 : ctx.shock;
  const g = new GraphBuilder();
  const ev = g.node("event", "event", "Supply disruption");
  const crude = g.node("crude", "macro", "Crude price");
  const up = g.node("upstream", "sector", "Upstream producers");
  const fuel = g.node("fuel", "sector", "Fuel-intensive transport");
  const infl = g.node("infl", "macro", "Inflation expectations");
  g.edge(ev, crude, { sign: signOf(s), relationship: "commodity_sensitivity", directness: "direct", lag: "minutes", uncertainty: "medium", rationale: "Lost supply tightens the physical market", hypothesized: false });
  g.edge(crude, up, { sign: "positive", relationship: "commodity_sensitivity", directness: "second_order", lag: "hours", uncertainty: "medium", rationale: "Higher realized prices lift producer cash flows", hypothesized: false });
  g.edge(crude, fuel, { sign: "negative", relationship: "commodity_sensitivity", directness: "second_order", lag: "hours", uncertainty: "medium", rationale: "Fuel is a large share of operating cost", hypothesized: false });
  g.edge(crude, infl, { sign: "positive", relationship: "rate_sensitivity", directness: "second_order", lag: "days", uncertainty: "high", rationale: "Energy pass-through to headline inflation", hypothesized: true });
  const exposures = factorExposures(ctx, "oilPer10pct", s as Shock, "commodity_sensitivity", "Crude", { min: 2, limit: 5, preferProxies: false, hi: 5, mid: 3 });
  for (const e of exposures) {
    const n = g.node(`sec_${e.security.ticker}`, "security", e.security.ticker, e.security.id);
    g.edge(e.sign === "positive" ? up : fuel, n, { sign: e.sign, relationship: e.relationship, directness: "second_order", lag: "hours", uncertainty: "medium", rationale: e.mechanism, hypothesized: false });
  }
  return {
    family: "commodity_oil",
    label: "Oil supply shock",
    transmission: ["Supply disruption", `Crude ${arrow(s as Shock)}`, "Producers' realized prices ↑ / transport fuel costs ↑"],
    graph: g.build(),
    exposures,
    counterMechanisms: [
      "Spare capacity or strategic reserve releases can cap the price response.",
      "If the disruption is brief, futures curves may price a temporary spike only (backwardation).",
    ],
    invalidation: ["Front-month crude gives back the move", "Operator reports restoration of flows within days"],
    openQuestions: ["How much capacity is offline and for how long?", "Is the move concentrated in front-month contracts?"],
    scenario: {
      upside: "Flows restored quickly; transport names recover as crude retraces.",
      downside: "Extended outage: producers re-rate higher, fuel-intensive margins compress further.",
    },
  };
}

function issuerFamily(ctx: MechanismContext, cfg: { sign: Sign; label: string; why: string; competitorSign: Sign; supplierSign: Sign | null; customerSign: Sign | null; family: string }): MechanismResult {
  const g = new GraphBuilder();
  const ev = g.node("event", "event", cfg.label);
  const cf = g.node("cashflow", "channel", "Expected cash flows");
  const sev = severityFrom(Math.abs(ctx.magnitudeZ ?? 1), 1.5, 0.75);
  g.edge(ev, cf, { sign: cfg.sign, relationship: "direct", directness: "direct", lag: "minutes", uncertainty: ctx.magnitudeZ === null ? "high" : "medium", rationale: cfg.why, hypothesized: false });
  const exposures: ExposureCandidate[] = [
    ...issuerExposure(ctx, cfg.sign, sev, cfg.why, [cfg.label]),
    ...(cfg.supplierSign ? relationshipExposures(ctx, "supplier", cfg.supplierSign, "Supplier read-through: demand signal from a documented customer") : []),
    ...(cfg.customerSign ? relationshipExposures(ctx, "customer", cfg.customerSign, "Customer read-through: input availability/cost from a documented supplier") : []),
    ...relationshipExposures(ctx, "competitor", cfg.competitorSign, "Peer read-through: shared end-market (sign hypothesized)", 1),
    ...indexExposure(ctx, cfg.sign),
  ];
  for (const e of exposures) {
    const n = g.node(`sec_${e.security.ticker}`, "security", e.security.ticker, e.security.id);
    g.edge(cf, n, { sign: e.sign, relationship: e.relationship, directness: e.directness, lag: e.directness === "direct" ? "minutes" : "days", uncertainty: e.hypothesized ? "high" : "medium", rationale: e.mechanism, hypothesized: e.hypothesized });
  }
  return {
    family: cfg.family,
    label: cfg.label,
    transmission: [cfg.label, `${ctx.issuer?.ticker ?? "Issuer"} expected cash flows ${cfg.sign === "positive" ? "↑" : cfg.sign === "negative" ? "↓" : "±"}`, "Documented counterparties re-price on read-through"],
    graph: g.build(),
    exposures,
    counterMechanisms: [
      "Peers can move opposite to the issuer if the event reflects share shift rather than end-demand.",
      "A reaction already realized in pre-market may leave little remaining move.",
    ],
    invalidation: ["Management commentary on the call contradicts the headline", "Peer disclosures do not confirm the read-through"],
    openQuestions: ["Is the driver company-specific or industry-wide?", "What did the market expect beyond published consensus?"],
    scenario: {
      upside: cfg.sign === "negative" ? "Issue proves contained; shares recover part of the reaction." : "Follow-through as estimates are revised higher.",
      downside: cfg.sign === "negative" ? "Further disclosures widen the impact; estimate cuts follow." : "Quality of the beat questioned; reaction fades.",
    },
  };
}

function dealFamily(ctx: MechanismContext): MechanismResult {
  const g = new GraphBuilder();
  const ev = g.node("event", "event", "Acquisition announced");
  const exposures: ExposureCandidate[] = [];
  const target = ctx.dealRole === "acquirer" ? ctx.counterparty : ctx.issuer;
  const acquirer = ctx.dealRole === "acquirer" ? ctx.issuer : ctx.counterparty;
  if (target) {
    exposures.push({
      security: target,
      relationship: "direct",
      directness: "direct",
      sign: "positive",
      severity: "high",
      mechanism: "Target: offer premium anchors price toward deal terms",
      linkage: ["Named as target in the announcement", "Price converges toward offer less deal-risk spread"],
      support: [{ text: `Target named in deal announcement: ${target.name}`, path: `/ticker/${target.ticker}` }],
      hypothesized: false,
      channelKey: "direct:positive",
    });
  }
  if (acquirer) {
    exposures.push({
      security: acquirer,
      relationship: "direct",
      directness: "direct",
      sign: "mixed",
      severity: "medium",
      mechanism: "Acquirer: synergies vs. premium paid and financing",
      linkage: ["Named as acquirer in the announcement", "Overpayment and dilution risk vs. strategic value"],
      support: [{ text: `Acquirer named in deal announcement: ${acquirer.name}`, path: `/ticker/${acquirer.ticker}` }],
      hypothesized: false,
      channelKey: "direct:mixed",
    });
  }
  const anchor = target ?? acquirer;
  if (anchor) {
    const sub: MechanismContext = { ...ctx, issuer: anchor };
    exposures.push(...relationshipExposures(sub, "competitor", "positive", "Peer re-rating on implied takeover valuation (hypothesized)", 1));
  }
  const prem = g.node("premium", "channel", "Offer premium");
  g.edge(ev, prem, { sign: "positive", relationship: "direct", directness: "direct", lag: "minutes", uncertainty: "low", rationale: "Announced terms set a price anchor", hypothesized: false });
  for (const e of exposures) {
    const n = g.node(`sec_${e.security.ticker}`, "security", e.security.ticker, e.security.id);
    g.edge(prem, n, { sign: e.sign, relationship: e.relationship, directness: e.directness, lag: "minutes", uncertainty: e.hypothesized ? "high" : "low", rationale: e.mechanism, hypothesized: e.hypothesized });
  }
  return {
    family: "corporate_deal",
    label: "M&A",
    transmission: ["Deal terms announced", "Target converges to offer less risk spread", "Acquirer weighs synergies vs. premium"],
    graph: g.build(),
    exposures,
    counterMechanisms: ["Regulatory review or financing risk can widen the spread.", "A competing bid would move the target above terms."],
    invalidation: ["Regulator signals a second request or challenge", "Financing conditions change materially"],
    openQuestions: ["What regulatory approvals are required?", "Is the consideration cash or stock?"],
    scenario: { upside: "Competing interest or fast approval narrows the spread.", downside: "Antitrust challenge widens the spread sharply." },
  };
}

/** Broad-market headlines: link to index proxies only (no single-name exposure is invented). */
function marketFamily(ctx: MechanismContext, which: "equities" | "rates" | "oil"): MechanismResult {
  const s = ctx.shock;
  const g = new GraphBuilder();
  const ev = g.node("event", "event", which === "equities" ? "Equity market move" : which === "rates" ? "Rates move" : "Oil price move");
  const pick = which === "equities" ? ["SPY", "QQQ", "IWM"] : which === "rates" ? ["TLT", "QQQ"] : ["XLE", "SPY"];
  const exposures: ExposureCandidate[] = [];
  for (const t of pick) {
    const sec = ctx.master.byTicker(t);
    if (!sec) continue;
    // A headline reports a move that already happened; it is not a forward call, so no sign is asserted.
    const sign: Sign = "mixed";
    exposures.push({
      security: sec,
      relationship: which === "rates" ? "rate_sensitivity" : which === "oil" ? "commodity_sensitivity" : "index",
      directness: "second_order",
      sign,
      severity: "low",
      mechanism: which === "equities" ? "Broad-market proxy for the reported move" : which === "rates" ? "Duration exposure to the reported yield move" : "Energy-sector proxy for the reported crude move",
      linkage: ["Headline describes a market-wide move", `${sec.ticker} is a market proxy (hypothesized link)`],
      support: [{ text: `${sec.ticker}: market proxy in the security master`, path: `/ticker/${sec.ticker}` }],
      hypothesized: true,
      channelKey: `${which}:${sign}`,
    });
    const n = g.node(`sec_${sec.ticker}`, "security", sec.ticker, sec.id);
    g.edge(ev, n, { sign, relationship: "hypothesized", directness: "second_order", lag: "hours", uncertainty: "high", rationale: "Market-wide headline mapped to a proxy", hypothesized: true });
  }
  return {
    family: `market_${which}`,
    label: "Market move",
    transmission: s === 0 ? ["Market-wide report", "Direction not stated in the headline"] : [`Reported ${which === "rates" ? "yields" : which === "oil" ? "crude" : "equities"} ${s > 0 ? "higher" : "lower"}`, "Proxy assets reprice"],
    graph: g.build(),
    exposures,
    counterMechanisms: ["Headlines describe moves already in prices; the remaining reaction may be small."],
    invalidation: ["The reported move reverses intraday"],
    openQuestions: ["What specific catalyst drove the move?"],
    scenario: { upside: "Move extends as positioning adjusts.", downside: "Move fades once the catalyst is digested." },
  };
}

export function buildMechanism(ctx: MechanismContext): MechanismResult {
  const st = ctx.subtype;
  if (st === "market.equities") return marketFamily(ctx, "equities");
  if (st === "market.rates") return marketFamily(ctx, "rates");
  if (st === "market.oil") return marketFamily(ctx, "oil");
  if (st === "macro.cpi" || st === "macro.pce") return ratesFamily(ctx, "inflation");
  if (st === "macro.fomc") return ratesFamily(ctx, "policy");
  if (st === "macro.payrolls" || st === "macro.retail_sales" || st === "macro.gdp" || st === "macro.pmi") return growthFamily(ctx, false);
  if (st === "macro.jobless_claims") return growthFamily(ctx, true);
  if (st === "geopolitics.oil_supply") return oilFamily(ctx);
  if (st === "ma.announced" || st === "ma.completed") return dealFamily(ctx);
  const s: Sign = ctx.shock > 0 ? "positive" : ctx.shock < 0 ? "negative" : "mixed";
  if (st.startsWith("earnings.")) {
    return issuerFamily(ctx, {
      family: "issuer_earnings",
      sign: s,
      label: st === "earnings.guidance" ? `Guidance ${ctx.guidance}` : "Earnings report",
      why: ctx.guidance === "raised" || ctx.guidance === "lowered" ? `Guidance ${ctx.guidance}: forward cash-flow expectations reset` : "Results vs. expectations reset near-term estimates",
      competitorSign: s,
      supplierSign: ctx.guidance !== "none" ? s : null,
      customerSign: null,
    });
  }
  if (st === "regulation.drug_approval") {
    return issuerFamily(ctx, { family: "issuer_regulatory", sign: s, label: "Regulatory decision", why: s === "positive" ? "Approval opens the revenue path" : "Rejection delays or removes the revenue path", competitorSign: flip(s), supplierSign: null, customerSign: null });
  }
  if (st === "regulation.export_controls") {
    return issuerFamily(ctx, { family: "issuer_regulatory", sign: "negative", label: "Export restriction", why: "Restricted sales to affected markets reduce addressable revenue", competitorSign: "mixed", supplierSign: "negative", customerSign: "negative" });
  }
  if (st === "sector.price_war") {
    return issuerFamily(ctx, { family: "issuer_price_war", sign: "negative", label: "Price cuts", why: "Lower fares or prices compress margins unless volume offsets", competitorSign: "negative", supplierSign: null, customerSign: null });
  }
  if (st === "company.buyback") {
    return issuerFamily(ctx, { family: "issuer_capital_return", sign: "positive", label: "Capital return", why: "Repurchases signal confidence and reduce share count", competitorSign: "mixed", supplierSign: null, customerSign: null });
  }
  if (st === "sector.supply_shortage") {
    return issuerFamily(ctx, { family: "sector_supply", sign: "positive", label: "Supply shortage", why: "Tight supply supports pricing for producers", competitorSign: "positive", supplierSign: null, customerSign: "negative" });
  }
  const negative = ["regulation.antitrust", "company.cyber_incident", "company.recall", "company.credit_downgrade", "company.restatement", "company.delisting_notice", "company.impairment", "geopolitics.shipping"];
  if (negative.includes(st)) {
    return issuerFamily(ctx, { family: "issuer_adverse", sign: "negative", label: "Adverse company event", why: "Costs, liabilities or funding stress lower expected cash flows", competitorSign: "mixed", supplierSign: null, customerSign: null });
  }
  return issuerFamily(ctx, { family: "issuer_other", sign: s, label: "Company disclosure", why: "Disclosure changes the information set; direction depends on details", competitorSign: "mixed", supplierSign: null, customerSign: null });
}

/** Magnitude-only refinement of a surprise bucket (direction is already in the channel sign). */
export function magnitudeBucket(bucket: string): string {
  if (bucket === "pos_large" || bucket === "neg_large") return "large";
  if (bucket === "pos" || bucket === "neg") return "moderate";
  if (bucket === "flat") return "small";
  return bucket;
}

/**
 * Forecast-group path shared by the training history and live scoring, coarse → fine:
 *   subtype → subtype|channel:sign → subtype|channel:sign|magnitude
 * The channel sign already encodes the expected direction for that exposure, so pooling at the
 * second level is coherent; sparse third-level cells back off to it.
 */
export function forecastPath(subtype: string, bucket: string, channelKey: string): string[] {
  return [subtype, `${subtype}|${channelKey}`, `${subtype}|${channelKey}|${magnitudeBucket(bucket)}`];
}
