import { randomUUID } from "node:crypto";
import { getRepository } from "@/lib/db/client";
import { requireUser, WatchlistBody } from "@/lib/api/account";
import { json, parseBody } from "@/lib/security/api";

export async function GET(req: Request) {
  const { user, res } = await requireUser(req);
  if (!user) return res;
  return json({ watchlists: await getRepository().listWatchlists(user.id) });
}

export async function POST(req: Request) {
  const { user, res } = await requireUser(req, true);
  if (!user) return res;
  const body = await parseBody(req, WatchlistBody);
  if (!body.ok) return body.res;
  const w = { id: body.data.id ?? randomUUID().slice(0, 12), userId: user.id, name: body.data.name, tickers: [...new Set(body.data.tickers)], createdAt: new Date().toISOString() };
  await getRepository().upsertWatchlist(w);
  return json({ watchlist: w }, { status: 201 });
}
