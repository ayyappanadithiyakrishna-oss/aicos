import { NextResponse } from "next/server";
import type { z } from "zod";

export const MAX_BODY_BYTES = 16_384;

export function json(data: unknown, init: { status?: number; cache?: "no-store" | "short" } = {}) {
  return NextResponse.json(data, {
    status: init.status ?? 200,
    headers: {
      "Cache-Control": init.cache === "short" ? "public, s-maxage=30, stale-while-revalidate=120" : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function error(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status });
}

export function parseQuery<T extends z.ZodTypeAny>(req: Request, schema: T): { ok: true; data: z.infer<T> } | { ok: false; res: NextResponse } {
  const url = new URL(req.url);
  const obj: Record<string, string> = {};
  for (const [k, v] of url.searchParams) obj[k] = v;
  const r = schema.safeParse(obj);
  if (!r.success) return { ok: false, res: error(400, "invalid_query", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")) };
  return { ok: true, data: r.data };
}

export async function parseBody<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return { ok: false, res: error(413, "body_too_large", `Body exceeds ${MAX_BODY_BYTES} bytes`) };
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, res: error(400, "invalid_body", "Unreadable body") };
  }
  if (raw.length > MAX_BODY_BYTES) return { ok: false, res: error(413, "body_too_large", `Body exceeds ${MAX_BODY_BYTES} bytes`) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, res: error(400, "invalid_json", "Body must be JSON") };
  }
  const r = schema.safeParse(parsed);
  if (!r.success) return { ok: false, res: error(400, "invalid_body", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")) };
  return { ok: true, data: r.data };
}

export const TICKER_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
