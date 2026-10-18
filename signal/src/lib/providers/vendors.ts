/**
 * Licensed-vendor adapters (FMP, Massive). Technical API access is not proof of redistribution
 * rights: these adapters only feed the public UI when the operator explicitly attests a display
 * license via environment flags. Payloads are schema-checked; unknown shapes raise schema errors.
 */
import { z } from "zod";
import type { PriceBar } from "@/lib/domain/types";
import type { RawRecord } from "@/lib/ingestion/types";
import { sanitizeText, safeExternalUrl } from "@/lib/security/sanitize";
import { sessionOn } from "@/lib/calendar/nyse";
import { dateKeyOf, zonedToUtc } from "@/lib/calendar/time";
import { ProviderError, providerJson } from "./http";

const FmpNews = z.array(
  z
    .object({
      symbol: z.string().nullable().optional(),
      publishedDate: z.string(),
      publisher: z.string().nullable().optional(),
      title: z.string(),
      site: z.string().nullable().optional(),
      text: z.string().nullable().optional(),
      url: z.string(),
    })
    .passthrough(),
);

/** FMP returns exchange-local timestamps without a zone ("YYYY-MM-DD HH:mm:ss", US/Eastern). */
export function fmpTime(s: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/.exec(s.trim());
  if (!m) return null;
  return zonedToUtc(m[1]!, Number(m[2]), Number(m[3])).toISOString();
}

/** Daily bars are stamped at that session's regular close (bar END), honoring early closes. */
function closeStamp(dateKey: string): string | null {
  return sessionOn(dateKey)?.close.toISOString() ?? null;
}

export async function fmpLatestNews(apiKey: string, fetchedAt: string, fetchImpl?: typeof fetch): Promise<RawRecord[]> {
  const raw = await providerJson(`https://financialmodelingprep.com/stable/news/stock-latest?page=0&limit=50&apikey=${encodeURIComponent(apiKey)}`, { provider: "fmp", ratePerSec: 4, revalidate: 120, fetchImpl });
  const parsed = FmpNews.safeParse(raw);
  if (!parsed.success) throw new ProviderError("fmp", "schema", "Unexpected FMP news payload shape");
  return parsed.data.flatMap((n) => {
    const url = safeExternalUrl(n.url);
    if (!url) return [];
    const publishedAt = fmpTime(n.publishedDate);
    return [
      {
        provider: "fmp",
        providerId: url,
        kind: "news" as const,
        url,
        title: sanitizeText(n.title, 300),
        excerpt: sanitizeText(n.text ?? "", 400),
        contentScope: "snippet" as const,
        publisher: sanitizeText(n.publisher ?? n.site ?? "Unknown publisher", 80),
        sourceId: "fmp-news",
        publishedAt,
        fetchedAt,
        tickers: n.symbol ? [n.symbol.toUpperCase()] : [],
        isOriginalDisclosure: false,
        isSynthetic: false,
      },
    ];
  });
}

const FmpEod = z.array(z.object({ date: z.string(), open: z.number(), high: z.number(), low: z.number(), close: z.number(), volume: z.number() }).passthrough());

export async function fmpDailyBars(apiKey: string, symbol: string, from: string, fetchImpl?: typeof fetch): Promise<PriceBar[]> {
  const raw = await providerJson(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=${from}&apikey=${encodeURIComponent(apiKey)}`, { provider: "fmp", ratePerSec: 4, revalidate: 900, fetchImpl });
  const parsed = FmpEod.safeParse(raw);
  if (!parsed.success) throw new ProviderError("fmp", "schema", "Unexpected FMP EOD payload shape");
  return parsed.data
    .flatMap((b) => {
      const t = closeStamp(b.date.slice(0, 10));
      return t ? [{ t, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }] : [];
    })
    .sort((a, b) => a.t.localeCompare(b.t));
}

const MassiveNews = z.object({
  results: z.array(
    z
      .object({
        id: z.string(),
        article_url: z.string(),
        title: z.string(),
        description: z.string().nullable().optional(),
        published_utc: z.string(),
        tickers: z.array(z.string()).optional(),
        publisher: z.object({ name: z.string() }).passthrough().optional(),
      })
      .passthrough(),
  ),
});

export async function massiveNews(apiKey: string, fetchedAt: string, fetchImpl?: typeof fetch): Promise<RawRecord[]> {
  const raw = await providerJson(`https://api.massive.com/v2/reference/news?limit=50&order=desc&sort=published_utc&apiKey=${encodeURIComponent(apiKey)}`, { provider: "massive", ratePerSec: 2, revalidate: 120, fetchImpl });
  const parsed = MassiveNews.safeParse(raw);
  if (!parsed.success) throw new ProviderError("massive", "schema", "Unexpected Massive news payload shape");
  return parsed.data.results.flatMap((n) => {
    const url = safeExternalUrl(n.article_url);
    if (!url) return [];
    return [
      {
        provider: "massive",
        providerId: n.id,
        kind: "news" as const,
        url,
        title: sanitizeText(n.title, 300),
        excerpt: sanitizeText(n.description ?? "", 400),
        contentScope: "snippet" as const,
        publisher: sanitizeText(n.publisher?.name ?? "Unknown publisher", 80),
        sourceId: "massive-news",
        publishedAt: Number.isFinite(Date.parse(n.published_utc)) ? new Date(n.published_utc).toISOString() : null,
        fetchedAt,
        tickers: (n.tickers ?? []).map((t) => t.toUpperCase()),
        isOriginalDisclosure: false,
        isSynthetic: false,
      },
    ];
  });
}

const MassiveAggs = z.object({ results: z.array(z.object({ t: z.number(), o: z.number(), h: z.number(), l: z.number(), c: z.number(), v: z.number() }).passthrough()).optional() });

export async function massiveDailyBars(apiKey: string, symbol: string, from: string, to: string, fetchImpl?: typeof fetch): Promise<PriceBar[]> {
  const raw = await providerJson(`https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&apiKey=${encodeURIComponent(apiKey)}`, { provider: "massive", ratePerSec: 2, revalidate: 900, fetchImpl });
  const parsed = MassiveAggs.safeParse(raw);
  if (!parsed.success) throw new ProviderError("massive", "schema", "Unexpected Massive aggregates payload shape");
  // Daily aggregate timestamps mark the session date; re-stamp at that session's regular close.
  return (parsed.data.results ?? []).flatMap((b) => {
    const t = closeStamp(dateKeyOf(new Date(b.t + 12 * 3_600_000)));
    return t ? [{ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }] : [];
  });
}
