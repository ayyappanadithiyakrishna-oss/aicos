/**
 * Authorization helpers for route handlers.
 * - Cron: Vercel sends `Authorization: Bearer ${CRON_SECRET}`; secrets shorter than 16 chars are refused.
 * - Admin: `Authorization: Bearer ${ADMIN_TOKEN}` for operator endpoints (manual ingest/replay).
 * - Users: no identity provider is configured in this build, so account endpoints return 401 and
 *   the UI keeps watchlists/alerts in the browser. A real provider plugs into `getSessionUser`.
 */
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function cronAuthorized(req: Request, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 16) return false;
  const token = bearer(req);
  return token !== null && safeEqual(token, secret);
}

export function adminAuthorized(req: Request, token: string | undefined = process.env.ADMIN_TOKEN): boolean {
  if (!token || token.length < 16) return false;
  const t = bearer(req);
  return t !== null && safeEqual(t, token);
}

export interface SessionUser {
  id: string;
}

/** No identity provider configured → no session. */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  void req;
  return null;
}

/** Same-origin check for state-changing requests (CSRF defence in depth on top of auth). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients; still require auth
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}
