/**
 * Data licensing matrix. Technical access ≠ redistribution permission; each row states what the
 * app needs before vendor content may be shown publicly, and how the code enforces it.
 */
export interface LicenseRow {
  provider: string;
  data: string;
  publicDisplay: string;
  derivedUse: string;
  enforcement: string;
}

export const LICENSE_MATRIX: LicenseRow[] = [
  { provider: "SEC EDGAR", data: "Filings metadata, items, accession, links", publicDisplay: "Public data; attribute SEC; obey fair-access (User-Agent, ≤10 req/s)", derivedUse: "Permitted", enforcement: "Requires SEC_USER_AGENT with contact email; 5 req/s token bucket; responses cached" },
  { provider: "FRED / ALFRED", data: "Macro observations, vintages", publicDisplay: "Allowed with attribution; some third-party series carry copyright — only public-domain agency series are used", derivedUse: "Permitted for listed series", enforcement: "Fixed series allowlist; FRED never treated as consensus" },
  { provider: "Financial Modeling Prep", data: "News snippets, EOD prices, calendars", publicDisplay: "Requires a plan whose terms allow public display/redistribution", derivedUse: "Plan-dependent", enforcement: "Hidden unless FMP_DISPLAY_LICENSE=confirmed; consensus only with FMP_CONSENSUS_LICENSED=true" },
  { provider: "Massive (formerly Polygon)", data: "News, aggregates", publicDisplay: "Personal tiers do not authorize public redistribution; commercial display license required", derivedUse: "License-dependent", enforcement: "Hidden unless MASSIVE_DISPLAY_LICENSE=confirmed" },
  { provider: "Anthropic API", data: "Extraction of provided snippets", publicDisplay: "n/a (processing only)", derivedUse: "Only if each content vendor permits sending content to an AI provider", enforcement: "Off unless LLM_PROCESSING_ALLOWED=true; outputs schema- and evidence-validated" },
  { provider: "Company logos", data: "Brand marks", publicDisplay: "Only with trademark/branding permission", derivedUse: "—", enforcement: "Monogram fallback unless brandingRights=licensed" },
  { provider: "Options chains", data: "IV, straddles", publicDisplay: "Requires an entitled OPRA-derived feed", derivedUse: "License-dependent", enforcement: "Not integrated; implied-move module shows unavailable" },
  { provider: "Demo generator", data: "Synthetic world", publicDisplay: "Fictional; always labelled DEMO", derivedUse: "Unrestricted", enforcement: "Mode-separated: never mixed with live feeds" },
];
