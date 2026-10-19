/**
 * Deterministic extractor (always available; used when no model credentials or when model
 * processing is not permitted by the vendor agreement). Produces the same strict contract as
 * the model-backed extractor. It summarizes only the provided title/snippet/structured payload.
 */
import type { EventType } from "@/lib/domain/types";
import type { RawRecord } from "@/lib/ingestion/types";
import { detectInjection } from "@/lib/security/sanitize";
import { ExtractionSchema, type ExtractedNumber, type Extraction } from "./schema";
import { fmtNum } from "./format";

export interface ExtractArticle {
  evidenceId: string;
  record: RawRecord;
}

const EIGHT_K_ITEMS: Record<string, { subtype: string; type: EventType; label: string }> = {
  "1.01": { subtype: "company.material_agreement", type: "company", label: "material definitive agreement" },
  "1.02": { subtype: "company.agreement_termination", type: "company", label: "termination of a material agreement" },
  "1.05": { subtype: "company.cyber_incident", type: "company", label: "material cybersecurity incident" },
  "2.01": { subtype: "ma.completed", type: "ma", label: "completion of acquisition or disposition" },
  "2.02": { subtype: "earnings.report", type: "earnings", label: "results of operations" },
  "2.05": { subtype: "company.restructuring", type: "company", label: "exit or restructuring costs" },
  "2.06": { subtype: "company.impairment", type: "company", label: "material impairment" },
  "3.01": { subtype: "company.delisting_notice", type: "company", label: "notice of delisting" },
  "4.02": { subtype: "company.restatement", type: "company", label: "non-reliance on prior financial statements" },
  "5.02": { subtype: "company.leadership_change", type: "company", label: "officer departure or appointment" },
  "7.01": { subtype: "company.reg_fd", type: "company", label: "Regulation FD disclosure" },
  "8.01": { subtype: "filing.other_event", type: "filing", label: "other events" },
};

/** Priority order of 8-K items when several are present. */
const ITEM_PRIORITY = ["1.05", "4.02", "2.01", "2.02", "1.01", "1.02", "5.02", "2.06", "2.05", "3.01", "8.01", "7.01"];

export function eightKItemInfo(items: readonly string[]) {
  for (const it of ITEM_PRIORITY) if (items.includes(it)) return { item: it, ...EIGHT_K_ITEMS[it]! };
  return null;
}

const MACRO_INDICATORS: Record<string, string> = {
  CPI: "macro.cpi",
  "Core CPI": "macro.cpi",
  "Nonfarm Payrolls": "macro.payrolls",
  "Unemployment Rate": "macro.payrolls",
  "FOMC Rate Decision": "macro.fomc",
  "Core PCE": "macro.pce",
  "GDP (QoQ SAAR)": "macro.gdp",
  "ISM Manufacturing PMI": "macro.pmi",
  "Retail Sales (MoM)": "macro.retail_sales",
  "Initial Jobless Claims": "macro.jobless_claims",
};

/** Vendor news streams whose excerpts are often marketing or commentary rather than reporting. */
const AGGREGATOR_SOURCES = new Set(["massive-news", "marketaux", "newsapi", "gdelt"]);
/** Opinion and listicle formats: useful context, never an event classification. */
const COMMENTARY = /^(is|should|could|would|can|will|why|how|what|here'?s|here is|\d+ (reasons?|stocks?|things?|key|top|dividend|growth|ai)|top \d+|best|the best|buy|sell|forget|prediction|my|i |these|this)\b|\b(key takeaways|stock (is )?a buy|worth (it|by \d{4})|investment (in|will)|could make you|millionaire|hold forever|before (it'?s too late|earnings|oct|nov|dec|jan|feb|mar|apr|may|jun|jul|aug|sep)|should you buy|is it time to|bull (vs\.?|and) bear|vs\.|1 (stock|thing))\b/i;

const KEYWORD_RULES: Array<{ subtype: string; type: EventType; re: RegExp }> = [
  { subtype: "macro.cpi", type: "macro", re: /\b(cpi|consumer price index|consumer prices)\b/i },
  { subtype: "macro.payrolls", type: "macro", re: /\b(payrolls|jobs report|nonfarm)\b/i },
  { subtype: "macro.fomc", type: "macro", re: /\b(fomc|rate decision|federal funds rate)\b/i },
  { subtype: "ma.announced", type: "ma", re: /\b(to acquire|agrees? to buy|merger agreement|takeover (bid|offer)|tender offer|all-cash deal)\b/i },
  { subtype: "earnings.guidance", type: "earnings", re: /\b(raises|lifts|lowers|cuts|reaffirms|withdraws|initiates)\b.{0,30}\b(guidance|outlook|forecast)\b/i },
  { subtype: "earnings.report", type: "earnings", re: /\b(quarterly results|q[1-4] (results|earnings)|earnings per share|eps\b|revenue (beat|miss)|tops estimates|misses estimates|beat(s|ing)? (estimates|expectations)|miss(es|ed)? (estimates|expectations)|record (profit|revenue)|quarterly (profit|revenue)|preliminary (quarterly )?revenue)/i },
  { subtype: "regulation.drug_approval", type: "regulation", re: /\b(fda|complete response letter|advisory committee)\b/i },
  { subtype: "regulation.antitrust", type: "regulation", re: /\b(antitrust|competition authority|sues to block|ftc|department of justice)\b/i },
  { subtype: "regulation.export_controls", type: "regulation", re: /\bexport (controls?|restrictions?|licen[cs]es?)\b/i },
  { subtype: "geopolitics.oil_supply", type: "geopolitics", re: /\b(oil supply|crude (supply|exports?)|pipeline (outage|shutdown)|refinery (outage|fire)|production cut)\b/i },
  { subtype: "geopolitics.shipping", type: "geopolitics", re: /\b(shipping lane|strait|canal|freight rates?) .{0,40}(disrupt|closure|attack|blocked)/i },
  { subtype: "company.cyber_incident", type: "company", re: /\b(cyber(attack|security incident)?|ransomware|data breach)\b/i },
  { subtype: "company.recall", type: "company", re: /\brecall(s|ed)?\b/i },
  { subtype: "company.credit_downgrade", type: "company", re: /\b(downgrade[sd]?|cuts?)\b.{0,40}\b(credit rating|rating to|junk)\b/i },
  { subtype: "company.leadership_change", type: "company", re: /\b(ceo|chief executive)\b.{0,30}\b(resigns|steps down|departs|to retire|ousted)\b/i },
  { subtype: "company.buyback", type: "company", re: /\b(buyback|share repurchase)\b/i },
  { subtype: "sector.supply_shortage", type: "sector", re: /\b(shortage|supply constraints?|allocation)\b/i },
  { subtype: "sector.price_war", type: "sector", re: /\b(price war|price cuts?|discounting)\b/i },
  { subtype: "macro.cpi", type: "macro", re: /\binflation (heats|cools|rises|falls|accelerates|eases|data|report)\b/i },
  { subtype: "market.rates", type: "macro", re: /\b(treasury yields?|bond (market|yields?|sell-?off)|10-year yield|mortgage rates)\b/i },
  { subtype: "market.oil", type: "geopolitics", re: /\b(oil prices?|crude (prices?|futures)|brent|opec)\b/i },
  { subtype: "market.equities", type: "sector", re: /\b(stock market|stocks? (rise|rises|rose|fall|falls|fell|rally|rallies|slide|slides|drop|drops|climb|climbs|close|closed|end|ended|open|opened|mixed|futures)|stock futures|equity futures|nasdaq (composite|futures|100)|s&p 500|dow (jones|futures)|wall street (rally|sell-?off|stocks|closes|ends|opens)|market (sell-?off|rally|rout)|broad market)\b/i },
];

export function classify(record: RawRecord): { type: EventType; subtype: string; why: string } {
  const s = record.structured;
  if (s?.macro) {
    const st = MACRO_INDICATORS[s.macro.indicator];
    if (st) return { type: "macro", subtype: st, why: `structured release: ${s.macro.indicator}` };
  }
  if (s?.filing) {
    const form = s.filing.form.toUpperCase();
    if (form.startsWith("8-K")) {
      const info = eightKItemInfo(s.filing.items);
      if (info) return { type: info.type, subtype: info.subtype, why: `8-K Item ${info.item} (${info.label})` };
      return { type: "filing", subtype: "filing.8k_other", why: "8-K without mapped item" };
    }
    if (form === "4") return { type: "filing", subtype: "filing.insider_form4", why: "Form 4" };
    if (form.startsWith("S-1")) return { type: "filing", subtype: "filing.registration_s1", why: "S-1" };
    if (form.startsWith("10-Q")) return { type: "filing", subtype: "filing.periodic_10q", why: "10-Q" };
    if (form.startsWith("10-K")) return { type: "filing", subtype: "filing.periodic_10k", why: "10-K" };
    if (form.startsWith("SC 13D")) return { type: "filing", subtype: "filing.activist_13d", why: "SC 13D" };
    return { type: "filing", subtype: "filing.other_form", why: `Form ${form}` };
  }
  if (s?.earnings) return { type: "earnings", subtype: "earnings.report", why: "structured earnings payload" };
  if (s?.deal) return { type: "ma", subtype: "ma.announced", why: "structured deal payload" };
  // Aggregator news is mostly commentary: classify on the headline, and treat opinion formats as such.
  const aggregated = AGGREGATOR_SOURCES.has(record.sourceId);
  if ((aggregated || record.sourceId === "cnbc") && (COMMENTARY.test(record.title) || /where we[’']re|finding opportunities|what to expect|week ahead|our (picks|favorite|favourite)|top wall street analysts|smartest buys|stocks? to buy/i.test(record.title))) return { type: "other", subtype: "other.unclassified", why: "commentary / opinion headline" };
  const text = (aggregated || record.sourceId === "cnbc") ? record.title : `${record.title} ${record.excerpt}`;
  for (const r of KEYWORD_RULES) {
    // Short RSS summaries frequently describe trade flows without announcing a disruption.
    if (record.sourceId === "cnbc" && r.subtype === "geopolitics.oil_supply" && !/\b(disrupt\w*|outage|shutdown|attack\w*|cuts?|halt\w*|block\w*|tighten\w*|shortage|suspend\w*)\b/i.test(text)) continue;
    if (r.re.test(text)) return { type: r.type, subtype: r.subtype, why: `keyword: ${r.re.source.slice(0, 40)}` };
  }
  return { type: "other", subtype: "other.unclassified", why: "no rule matched" };
}

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;

export function extractNumbers(text: string, evidenceId: string): ExtractedNumber[] {
  const out: ExtractedNumber[] = [];
  const pctPair = new RegExp(String.raw`${NUM}%\s*(?:,\s*)?(?:vs\.?|versus|compared with|against)\s*(?:an? )?(?:consensus|expectations?|estimates?|forecasts?)?\s*(?:of\s*)?${NUM}%`, "gi");
  for (const m of text.matchAll(pctPair)) {
    out.push({ name: "headline", value: Number(m[1]), unit: "%", role: "actual", evidenceId, sourceText: m[0] });
    out.push({ name: "headline", value: Number(m[2]), unit: "%", role: "consensus", evidenceId, sourceText: m[0] });
  }
  const eps = new RegExp(String.raw`(?:EPS|earnings per share)[^$]{0,30}\$${NUM}[^$]{0,40}(?:vs\.?|versus|compared with|against)[^$]{0,30}\$${NUM}`, "gi");
  for (const m of text.matchAll(eps)) {
    out.push({ name: "eps", value: Number(m[1]), unit: "USD/share", role: "actual", evidenceId, sourceText: m[0] });
    out.push({ name: "eps", value: Number(m[2]), unit: "USD/share", role: "consensus", evidenceId, sourceText: m[0] });
  }
  const deal = new RegExp(String.raw`\$${NUM}\s*(billion|million)\b`, "gi");
  for (const m of text.matchAll(deal)) {
    const v = Number(m[1]) * (m[2]!.toLowerCase() === "billion" ? 1e9 : 1e6);
    out.push({ name: "deal_value", value: v, unit: "USD", role: "deal_value", evidenceId, sourceText: m[0] });
  }
  const prem = new RegExp(String.raw`${NUM}%\s*premium`, "gi");
  for (const m of text.matchAll(prem)) out.push({ name: "premium", value: Number(m[1]), unit: "%", role: "premium", evidenceId, sourceText: m[0] });
  return out.slice(0, 12);
}

function guidanceOf(text: string, structured?: RawRecord["structured"]): Extraction["guidance"] {
  if (structured?.earnings) return structured.earnings.guidance;
  if (/\b(raises|lifts|boosts)\b.{0,30}\b(guidance|outlook|forecast)\b/i.test(text)) return "raised";
  if (/\b(lowers|cuts|reduces)\b.{0,30}\b(guidance|outlook|forecast)\b/i.test(text)) return "lowered";
  if (/\b(reaffirms|maintains|reiterates)\b.{0,30}\b(guidance|outlook|forecast)\b/i.test(text)) return "reaffirmed";
  if (/\bwithdraws\b.{0,30}\b(guidance|outlook)\b/i.test(text)) return "withdrawn";
  if (/\binitiates\b.{0,30}\b(guidance|outlook)\b/i.test(text)) return "initiated";
  return "none";
}

/**
 * Build a validated extraction for a cluster. `bottomLine` and `whyItMatters` here are
 * placeholders; the explanation stage writes the final text from verified inputs.
 */
export function extractDeterministic(args: {
  eventId: string;
  articles: ExtractArticle[];
  entities: Array<{ ticker: string; entityId: string; directness: "direct" | "second_order"; mechanism: string; verified: boolean }>;
  generatedAt: string;
}): Extraction {
  const primary = args.articles.find((a) => a.record.isOriginalDisclosure) ?? args.articles[0]!;
  const cls = classify(primary.record);
  const numbers: ExtractedNumber[] = [];
  const injectionFlags: string[] = [];
  for (const a of args.articles) {
    const text = `${a.record.title}. ${a.record.excerpt}`;
    numbers.push(...extractNumbers(text, a.evidenceId));
    injectionFlags.push(...detectInjection(text));
    const sm = a.record.structured?.macro;
    if (sm) {
      // sourceText mirrors structuredSourceText() so verification is an exact substring match.
      numbers.push({ name: sm.indicator, value: sm.actual, unit: sm.unit, role: "actual", evidenceId: a.evidenceId, sourceText: `${sm.indicator} (${sm.period}) actual ${fmtNum(sm.actual, sm.unit)}` });
      if (sm.consensus) numbers.push({ name: sm.indicator, value: sm.consensus.value, unit: sm.consensus.unit, role: "consensus", evidenceId: a.evidenceId, sourceText: `consensus ${fmtNum(sm.consensus.value, sm.consensus.unit)}` });
      if (sm.prior !== null) numbers.push({ name: sm.indicator, value: sm.prior, unit: sm.unit, role: "prior", evidenceId: a.evidenceId, sourceText: `Prior reading ${fmtNum(sm.prior, sm.unit)}` });
    }
  }
  const text = args.articles.map((a) => `${a.record.title} ${a.record.excerpt}`).join(" ");
  const limitations: string[] = [];
  if (args.articles.every((a) => a.record.contentScope !== "full_text_licensed")) {
    limitations.push("Summarized from provider title/snippet and structured fields only; full article not read.");
  }
  if (injectionFlags.length) limitations.push("Source text contained instruction-like content; it was treated as data and ignored.");
  const deal = primary.record.structured?.deal;
  const extraction: Extraction = {
    eventId: args.eventId,
    summary: { bottomLine: "Pending explanation stage for this verified event cluster.", verifiedFacts: [], whyItMatters: "" },
    eventType: cls.type,
    subtype: cls.subtype,
    evidence: args.articles.map((a) => ({
      id: a.evidenceId,
      url: a.record.url,
      publishedAt: a.record.publishedAt ?? a.record.fetchedAt,
      publisher: a.record.publisher,
      kind: a.record.kind === "filing" ? "filing" : a.record.kind === "macro_release" ? "official_release" : a.record.kind === "press_release" ? "company_statement" : "news",
    })),
    hypotheses: [],
    entities: args.entities.slice(0, 10),
    numbers: dedupeNumbers(numbers),
    guidance: guidanceOf(text, primary.record.structured),
    dealRole: deal?.role ?? (/\b(to be acquired|agrees to be bought|target)\b/i.test(text) ? "target" : "none"),
    limitations,
    injectionFlags: [...new Set(injectionFlags)].slice(0, 10),
    generatedAt: args.generatedAt,
  };
  return ExtractionSchema.parse(extraction);
}

function dedupeNumbers(xs: ExtractedNumber[]): ExtractedNumber[] {
  const seen = new Set<string>();
  const out: ExtractedNumber[] = [];
  for (const x of xs) {
    const k = `${x.name}|${x.role}|${x.value}|${x.unit}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out.slice(0, 12);
}
