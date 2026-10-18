import { z } from "zod";
import { search } from "@/lib/data/service";
import { json, parseQuery } from "@/lib/security/api";

const Q = z.object({ q: z.string().trim().min(1).max(80) });

export async function GET(req: Request) {
  const q = parseQuery(req, Q);
  if (!q.ok) return q.res;
  return json({ hits: await search(q.data.q) }, { cache: "short" });
}
