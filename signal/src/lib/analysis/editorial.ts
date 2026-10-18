/**
 * Editorial rule checks applied to every generated explanation before publication.
 * Numbers in card prose are forbidden: quantitative values are rendered from forecast objects.
 */

export const BOTTOM_LINE_MIN_WORDS = 15;
export const BOTTOM_LINE_MAX_WORDS = 25;

const GENERIC_PHRASES = [
  /markets? (may|could|might) react (negatively|positively)/i,
  /could (impact|affect) the (stock )?market/i,
  /investors (are|will be) (watching|closely)/i,
  /remains to be seen/i,
  /time will tell/i,
];

const RECOMMENDATION = /\b(you should|investors should|we recommend|consider (buying|selling)|buy now|sell now|strong buy|strong sell|price target of)\b/i;
const CERTAINTY = /\b(will (surge|soar|crash|plunge|rally)|guaranteed|certain to|no doubt)\b/i;

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export interface EditorialResult {
  ok: boolean;
  issues: string[];
}

export function checkBottomLine(s: string): EditorialResult {
  const issues: string[] = [];
  const wc = wordCount(s);
  if (wc < BOTTOM_LINE_MIN_WORDS || wc > BOTTOM_LINE_MAX_WORDS) issues.push(`bottom line has ${wc} words (allowed ${BOTTOM_LINE_MIN_WORDS}–${BOTTOM_LINE_MAX_WORDS})`);
  if (/\d/.test(s)) issues.push("bottom line contains numbers (numbers must come from verified facts or quant code)");
  issues.push(...checkProse(s).issues);
  return { ok: issues.length === 0, issues };
}

export function checkProse(s: string): EditorialResult {
  const issues: string[] = [];
  for (const re of GENERIC_PHRASES) if (re.test(s)) issues.push(`generic phrase: ${re.source}`);
  if (RECOMMENDATION.test(s)) issues.push("contains a trading recommendation");
  if (CERTAINTY.test(s)) issues.push("states an uncertain outcome as certain");
  return { ok: issues.length === 0, issues };
}
