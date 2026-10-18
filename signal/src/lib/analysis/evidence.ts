/**
 * Evidence checks. A fact survives only if it cites an evidence ID that exists in stored sources
 * and every number it states appears in that source's provided text or structured payload.
 */
import type { Evidence, VerifiedFact } from "@/lib/domain/types";
import type { ExtractedNumber } from "./schema";

export interface EvidenceSource {
  evidence: Evidence;
  /** Exact provided text (title + snippet) and a flattened structured payload. */
  text: string;
}

export interface FactCheckResult {
  kept: VerifiedFact[];
  dropped: Array<{ text: string; reason: string }>;
}

const NUMBER_IN_TEXT = /-?\d+(?:[.,]\d+)?/g;

function numbersIn(s: string): string[] {
  return (s.match(NUMBER_IN_TEXT) ?? []).map((n) => n.replace(/,/g, ""));
}

export function checkFacts(
  facts: ReadonlyArray<{ text: string; evidenceId: string; label?: VerifiedFact["label"] }>,
  sources: readonly EvidenceSource[],
): FactCheckResult {
  const byId = new Map(sources.map((s) => [s.evidence.id, s] as const));
  const kept: VerifiedFact[] = [];
  const dropped: FactCheckResult["dropped"] = [];
  for (const f of facts) {
    const src = byId.get(f.evidenceId);
    if (!src) {
      dropped.push({ text: f.text, reason: `Unknown evidence ID ${f.evidenceId}` });
      continue;
    }
    const srcNums = new Set(numbersIn(src.text));
    const missing = numbersIn(f.text).filter((n) => !srcNums.has(n));
    if (missing.length) {
      dropped.push({ text: f.text, reason: `Numbers not found in cited source: ${missing.join(", ")}` });
      continue;
    }
    kept.push({ text: f.text, evidenceId: f.evidenceId, label: f.label ?? "confirmed_fact" });
  }
  return { kept: kept.slice(0, 3), dropped };
}

/**
 * High-impact numbers (actuals and consensus) must appear in their cited source. When they do
 * not, quantitative forecasting is blocked for the event.
 */
export function verifyNumbers(numbers: readonly ExtractedNumber[], sources: readonly EvidenceSource[]): {
  verified: ExtractedNumber[];
  unverified: ExtractedNumber[];
  highImpactVerified: boolean;
} {
  const byId = new Map(sources.map((s) => [s.evidence.id, s] as const));
  const verified: ExtractedNumber[] = [];
  const unverified: ExtractedNumber[] = [];
  for (const n of numbers) {
    const src = byId.get(n.evidenceId);
    const present = src ? src.text.includes(n.sourceText) && numbersIn(src.text).some((x) => Number(x) === n.value || Number(x) * 1e9 === n.value || Number(x) * 1e6 === n.value) : false;
    (present ? verified : unverified).push(n);
  }
  const highImpact = numbers.filter((n) => n.role === "actual" || n.role === "consensus");
  const highImpactVerified = highImpact.every((n) => verified.includes(n));
  return { verified, unverified, highImpactVerified };
}

/** Hypotheses and exposures may only cite evidence that exists. */
export function validEvidenceRefs(refs: readonly string[], sources: readonly EvidenceSource[]): boolean {
  const ids = new Set(sources.map((s) => s.evidence.id));
  return refs.length > 0 && refs.every((r) => ids.has(r));
}
