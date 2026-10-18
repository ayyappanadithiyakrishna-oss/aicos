import { z } from "zod";
import { getArchive } from "@/lib/data/service";
import { json, parseQuery, TICKER_RE } from "@/lib/security/api";

const Q = z.object({
  ticker: z.string().toUpperCase().regex(TICKER_RE).optional(),
  horizon: z.enum(["1h", "next_session", "5_sessions"]).optional(),
  sample: z.enum(["current", "oos"]).optional(),
  status: z.enum(["pending", "resolved", "failed", "not_resolvable"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(req: Request) {
  const q = parseQuery(req, Q);
  if (!q.ok) return q.res;
  return json(await getArchive(q.data), { cache: "short" });
}
