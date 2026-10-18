/**
 * Strict LLM / extractor output contract. Both the deterministic extractor and the optional
 * model-backed extractor must produce this shape; anything else is rejected before persistence.
 */
import { z } from "zod";
import { EVENT_TYPES } from "@/lib/domain/types";

export const EvidenceRefSchema = z
  .object({
    id: z.string().min(1).max(64),
    url: z.string().max(2048),
    publishedAt: z.string(),
    publisher: z.string().max(120),
    kind: z.enum(["filing", "official_release", "wire", "news", "company_statement", "data"]),
  })
  .strict();

export const ExtractedNumberSchema = z
  .object({
    name: z.string().max(60),
    value: z.number().finite(),
    unit: z.string().max(24),
    role: z.enum(["actual", "consensus", "prior", "revised_prior", "guidance", "deal_value", "premium", "other"]),
    evidenceId: z.string(),
    /** The exact substring of the source that contains the number. */
    sourceText: z.string().max(200),
  })
  .strict();

export const ExtractionSchema = z
  .object({
    eventId: z.string(),
    summary: z
      .object({
        bottomLine: z.string().min(20).max(240),
        verifiedFacts: z.array(z.object({ text: z.string().min(5).max(260), evidenceId: z.string() }).strict()).max(3),
        whyItMatters: z.string().max(320),
      })
      .strict(),
    eventType: z.enum(EVENT_TYPES),
    subtype: z.string().regex(/^[a-z]+(\.[a-z0-9_]+)+$/),
    evidence: z.array(EvidenceRefSchema).min(1),
    hypotheses: z
      .array(
        z
          .object({
            cause: z.string().max(200),
            transmission: z.string().max(240),
            affectedExposure: z.string().max(120),
            sign: z.enum(["positive", "negative", "mixed"]),
            supportedBy: z.array(z.string()),
          })
          .strict(),
      )
      .max(4),
    entities: z
      .array(
        z
          .object({
            ticker: z.string().max(12),
            entityId: z.string(),
            directness: z.enum(["direct", "second_order"]),
            mechanism: z.string().max(160),
            verified: z.boolean(),
          })
          .strict(),
      )
      .max(10),
    numbers: z.array(ExtractedNumberSchema).max(12),
    guidance: z.enum(["raised", "lowered", "reaffirmed", "initiated", "withdrawn", "none"]),
    dealRole: z.enum(["target", "acquirer", "none"]),
    limitations: z.array(z.string().max(200)).max(6),
    injectionFlags: z.array(z.string()).max(10),
    generatedAt: z.string(),
  })
  .strict();

export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedNumber = z.infer<typeof ExtractedNumberSchema>;
