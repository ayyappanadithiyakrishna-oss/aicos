import { z } from "zod";
import { getScorecard } from "@/lib/data/service";
import { json, parseQuery } from "@/lib/security/api";

const Q = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  minSample: z.coerce.number().int().min(5).max(1000).optional(),
});

export async function GET(req: Request) {
  const q = parseQuery(req, Q);
  if (!q.ok) return q.res;
  return json(await getScorecard(q.data), { cache: "short" });
}
