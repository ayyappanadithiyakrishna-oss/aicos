/**
 * Economic surprise = actual − consensus, only when both come in the same unit and the consensus
 * is from a licensed source. The prior print is NEVER substituted for a missing consensus.
 * A z-score is computed only from a historical forecast-error distribution of adequate size.
 */
import type { MacroSurprise } from "@/lib/domain/types";
import { mean, std } from "@/lib/quant/stats";

export const MIN_ERROR_HISTORY = 12;

export interface MacroReleaseInput {
  indicator: string;
  unit: string;
  actual: number;
  prior: number | null;
  revisedPrior: number | null;
}

export interface ConsensusInput {
  value: number;
  unit: string;
  source: string;
  licensed: boolean;
}

export class UnitMismatchError extends Error {}

export function computeMacroSurprise(
  release: MacroReleaseInput,
  consensus: ConsensusInput | null,
  historicalErrors: readonly number[] = [],
): MacroSurprise {
  const base: MacroSurprise = {
    indicator: release.indicator,
    unit: release.unit,
    actual: release.actual,
    consensus: null,
    consensusSource: null,
    prior: release.prior,
    revisedPrior: release.revisedPrior,
    surprise: null,
    surpriseZ: null,
    historyN: historicalErrors.length,
    note: null,
  };
  if (!consensus) return { ...base, note: "No licensed consensus — surprise not computed (prior print is not a consensus)." };
  if (!consensus.licensed) return { ...base, note: "Consensus source not licensed for display — surprise withheld." };
  if (normalizeUnit(consensus.unit) !== normalizeUnit(release.unit)) {
    throw new UnitMismatchError(`Unit mismatch for ${release.indicator}: actual in ${release.unit}, consensus in ${consensus.unit}`);
  }
  const surprise = roundTo(release.actual - consensus.value, 4);
  let surpriseZ: number | null = null;
  let note: string | null = null;
  if (historicalErrors.length >= MIN_ERROR_HISTORY) {
    const s = std(historicalErrors);
    if (s > 0) surpriseZ = roundTo((surprise - mean(historicalErrors)) / s, 2);
  } else {
    note = `z-score withheld: ${historicalErrors.length} historical forecast errors (< ${MIN_ERROR_HISTORY}).`;
  }
  return { ...base, consensus: consensus.value, consensusSource: consensus.source, surprise, surpriseZ, note };
}

function normalizeUnit(u: string): string {
  return u.trim().toLowerCase().replace(/\s+/g, " ").replace("percent", "%").replace("pct", "%");
}

function roundTo(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
