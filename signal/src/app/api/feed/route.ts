import { FeedQuerySchema } from "@/lib/data/feedQuery";
import { toCard } from "@/lib/data/cards";
import { getFeed } from "@/lib/data/service";
import { json, parseQuery } from "@/lib/security/api";

export async function GET(req: Request) {
  const q = parseQuery(req, FeedQuerySchema);
  if (!q.ok) return q.res;
  const feed = await getFeed(q.data);
  const items = q.data.format === "full" ? feed.items : feed.items.map(toCard);
  return json({ mode: feed.mode, items, total: feed.total, nextCursor: feed.nextCursor, categories: feed.categories, freshness: feed.freshness }, { cache: "short" });
}
