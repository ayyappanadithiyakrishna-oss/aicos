/**
 * Event-quality indicator: source reliability + verified facts + timeliness + provider freshness
 * + quantified evidence + distinctiveness. A transparent composite — not a model confidence.
 */
import type { ConfirmationStatus, EventQuality } from "@/lib/domain/types";

export const QUALITY_WEIGHTS = {
  sourceReliability: 0.25,
  verifiedFacts: 0.2,
  timeliness: 0.15,
  providerFreshness: 0.1,
  quantifiedEvidence: 0.15,
  distinctiveness: 0.15,
} as const;

export function eventQuality(args: {
  sourceReliability: number;
  verifiedFactCount: number;
  droppedFactCount: number;
  publishedAtKnown: boolean;
  ingestLagMinutes: number;
  providerStale: boolean;
  quantified: boolean;
  noveltyScore: number;
  confirmation: ConfirmationStatus;
}): EventQuality {
  const confirmBoost: Record<ConfirmationStatus, number> = {
    confirmed_filing: 1,
    official_release: 1,
    multiple_independent: 0.8,
    single_source: 0.55,
    unverified: 0.25,
  };
  const c = {
    sourceReliability: Math.min(1, args.sourceReliability * 0.6 + confirmBoost[args.confirmation] * 0.4),
    verifiedFacts: Math.min(1, args.verifiedFactCount / 3) * (args.droppedFactCount ? 0.7 : 1),
    timeliness: args.publishedAtKnown ? Math.max(0.2, 1 - args.ingestLagMinutes / 240) : 0.2,
    providerFreshness: args.providerStale ? 0.1 : 1,
    quantifiedEvidence: args.quantified ? 1 : 0.4,
    distinctiveness: args.noveltyScore,
  };
  let score = 0;
  for (const [k, w] of Object.entries(QUALITY_WEIGHTS)) score += w * c[k as keyof typeof c];
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    score: Math.round(score * 100),
    components: {
      sourceReliability: round(c.sourceReliability),
      verifiedFacts: round(c.verifiedFacts),
      timeliness: round(c.timeliness),
      providerFreshness: round(c.providerFreshness),
      quantifiedEvidence: round(c.quantifiedEvidence),
      distinctiveness: round(c.distinctiveness),
    },
  };
}
