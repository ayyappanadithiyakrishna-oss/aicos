import { universeRow } from "@/lib/live/universe";

/**
 * Company logo for a covered ticker, proxied same-origin so the page never talks to vendors directly.
 * Sources: London Strategic Edge logos, FMP public logo images, then logo.dev when LOGO_DEV_TOKEN is set.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await ctx.params;
  const t = ticker.toUpperCase();
  const row = /^[A-Z]{1,5}(\.[A-Z])?$/.test(t) ? universeRow(t) : undefined;
  const urls: string[] = [];
  const [src, sym] = row?.logo?.split(":") ?? [];
  if (src === "lse" && sym) urls.push(`https://api.londonstrategicedge.com/logos/${encodeURIComponent(sym)}.png`);
  if (src === "fmp" && sym) urls.push(`https://financialmodelingprep.com/image-stock/${encodeURIComponent(sym)}.png`);
  const token = process.env.LOGO_DEV_TOKEN;
  if (row && token) urls.push(`https://img.logo.dev/ticker/${encodeURIComponent(t)}?token=${encodeURIComponent(token)}&size=128&format=png`);
  for (const url of urls) {
    try {
      const res = await fetch(url, { next: { revalidate: 604_800 } });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.startsWith("image/")) continue;
      return new Response(await res.arrayBuffer(), {
        headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800", "X-Content-Type-Options": "nosniff" },
      });
    } catch {
      /* try the next source */
    }
  }
  return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
}
