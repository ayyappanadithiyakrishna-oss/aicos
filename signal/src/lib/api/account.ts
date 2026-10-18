import { z } from "zod";
import { getSessionUser, sameOrigin } from "@/lib/security/auth";
import { error } from "@/lib/security/api";
import { TICKER_RE } from "@/lib/security/api";

export const AUTH_NOT_CONFIGURED =
  "Account features require authentication, which is not configured on this deployment. Watchlists and alerts are kept in your browser instead.";

/** Resolve the signed-in user or return the 401 response to send. */
export async function requireUser(req: Request, write = false) {
  if (write && !sameOrigin(req)) return { user: null, res: error(403, "cross_origin", "Cross-origin writes are not allowed") } as const;
  const user = await getSessionUser(req);
  if (!user) return { user: null, res: error(401, "unauthenticated", AUTH_NOT_CONFIGURED) } as const;
  return { user, res: null } as const;
}

export const WatchlistBody = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/i).optional(),
  name: z.string().trim().min(1).max(60),
  tickers: z.array(z.string().toUpperCase().regex(TICKER_RE)).max(200),
});

export const AlertBody = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/i).optional(),
  kind: z.enum(["watchlist_material", "ticker_any", "filing", "second_order", "forecast_invalidation", "quality_change"]),
  tickers: z.array(z.string().toUpperCase().regex(TICKER_RE)).max(100),
  minSeverity: z.enum(["low", "medium", "high"]),
  minQuality: z.number().int().min(0).max(100),
  paused: z.boolean().default(false),
  digest: z.boolean().default(false),
  maxPerHour: z.number().int().min(1).max(60).default(6),
});
