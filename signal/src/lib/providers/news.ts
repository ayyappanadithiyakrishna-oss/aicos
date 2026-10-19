/**
 * Financial news adapters: Massive (formerly Polygon) reference news, Marketaux and NewsAPI.org.
 * Each maps to RawRecord with vendor ticker tags and, where the vendor provides it, per-ticker
 * sentiment. Payloads are schema-checked; budgets are enforced with rate limits + response caching.
 */
import { z } from "zod";
import type { RawRecord } from "@/lib/ingestion/types";
import { sanitizeText, safeExternalUrl } from "@/lib/security/sanitize";
import { ProviderError, providerJson } from "./http";

const iso = (s: string | null | undefined) => (s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null);

// ---------------------------------------------------------------- Massive

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
        insights: z.array(z.object({ ticker: z.string(), sentiment: z.string().optional(), sentiment_reasoning: z.string().optional() }).passthrough()).optional(),
      })
      .passthrough(),
  ),
  next_url: z.string().optional(),
});

const SENTIMENT: Record<string, number> = { positive: 1, negative: -1, neutral: 0 };

export function massiveToRecords(raw: unknown, fetchedAt: string): { records: RawRecord[]; next: string | null } {
  const parsed = MassiveNews.safeParse(raw);
  if (!parsed.success) throw new ProviderError("massive", "schema", "Unexpected Massive news payload shape");
  const records = parsed.data.results.flatMap((n): RawRecord[] => {
    const url = safeExternalUrl(n.article_url);
    if (!url) return [];
    return [
      {
        provider: "massive",
        providerId: n.id,
        kind: "news",
        url,
        title: sanitizeText(n.title, 300),
        excerpt: sanitizeText(n.description ?? "", 400),
        contentScope: "snippet",
        publisher: sanitizeText(n.publisher?.name ?? "Unknown publisher", 80),
        sourceId: "massive-news",
        publishedAt: iso(n.published_utc),
        fetchedAt,
        tickers: (n.tickers ?? []).map((t) => t.toUpperCase()),
        isOriginalDisclosure: false,
        isSynthetic: false,
        vendorSentiment: (n.insights ?? []).flatMap((i) => (i.sentiment && i.sentiment in SENTIMENT ? [{ ticker: i.ticker.toUpperCase(), score: SENTIMENT[i.sentiment]!, note: sanitizeText(i.sentiment_reasoning ?? "", 240) }] : [])),
      },
    ];
  });
  return { records, next: parsed.data.next_url ?? null };
}

const MASSIVE_RATE = 5 / 60; // Basic plan: 5 requests per minute

export async function massiveLatestNews(apiKey: string, fetchedAt: string, opts: { ticker?: string; limit?: number; sinceDays?: number } = {}, fetchImpl?: typeof fetch): Promise<RawRecord[]> {
  const since = new Date(Date.parse(fetchedAt) - (opts.sinceDays ?? 3) * 86_400_000).toISOString().slice(0, 10);
  const q = new URLSearchParams({ order: "desc", sort: "published_utc", limit: String(opts.limit ?? 250), "published_utc.gte": since, apiKey });
  if (opts.ticker) q.set("ticker", opts.ticker);
  const raw = await providerJson(`https://api.massive.com/v2/reference/news?${q}`, { provider: "massive", ratePerSec: MASSIVE_RATE, revalidate: opts.ticker ? 900 : 300, fetchImpl, attempts: 2 });
  return massiveToRecords(raw, fetchedAt).records;
}

// ---------------------------------------------------------------- Marketaux

const Marketaux = z.object({
  data: z.array(
    z
      .object({
        uuid: z.string(),
        title: z.string(),
        description: z.string().nullable().optional(),
        snippet: z.string().nullable().optional(),
        url: z.string(),
        published_at: z.string(),
        source: z.string().nullable().optional(),
        entities: z.array(z.object({ symbol: z.string(), type: z.string().nullable().optional(), sentiment_score: z.number().nullable().optional(), match_score: z.number().nullable().optional() }).passthrough()).optional(),
      })
      .passthrough(),
  ),
});

/**
 * Marketaux: entity-tagged financial news with per-entity sentiment. The free plan returns 3
 * articles per call and 100 calls per day, so responses are cached for 20 minutes (≤ 72 calls/day).
 */
export async function marketauxNews(apiToken: string, fetchedAt: string, opts: { symbols?: string[] } = {}, fetchImpl?: typeof fetch): Promise<RawRecord[]> {
  const q = new URLSearchParams({ language: "en", countries: "us", filter_entities: "true", must_have_entities: "true", entity_types: "equity,index,etf", limit: "3", api_token: apiToken });
  if (opts.symbols?.length) q.set("symbols", opts.symbols.join(","));
  const raw = await providerJson(`https://api.marketaux.com/v1/news/all?${q}`, { provider: "marketaux", ratePerSec: 1, revalidate: opts.symbols?.length ? 3600 : 1200, fetchImpl, attempts: 1 });
  const parsed = Marketaux.safeParse(raw);
  if (!parsed.success) throw new ProviderError("marketaux", "schema", "Unexpected Marketaux payload shape");
  return parsed.data.data.flatMap((a): RawRecord[] => {
    const url = safeExternalUrl(a.url);
    if (!url) return [];
    const ents = (a.entities ?? []).filter((e) => (e.type ?? "equity") !== "cryptocurrency");
    return [
      {
        provider: "marketaux",
        providerId: a.uuid,
        kind: "news",
        url,
        title: sanitizeText(a.title, 300),
        excerpt: sanitizeText(a.description ?? a.snippet ?? "", 400),
        contentScope: "snippet",
        publisher: sanitizeText(a.source ?? "Unknown publisher", 80),
        sourceId: "marketaux",
        publishedAt: iso(a.published_at),
        fetchedAt,
        tickers: ents.map((e) => e.symbol.toUpperCase()),
        isOriginalDisclosure: false,
        isSynthetic: false,
        vendorSentiment: ents.flatMap((e) => (typeof e.sentiment_score === "number" ? [{ ticker: e.symbol.toUpperCase(), score: Math.max(-1, Math.min(1, e.sentiment_score)), note: "" }] : [])),
      },
    ];
  });
}

// ---------------------------------------------------------------- NewsAPI.org

const NewsApi = z.object({
  status: z.string(),
  articles: z
    .array(
      z
        .object({
          source: z.object({ name: z.string().nullable().optional() }).passthrough().optional(),
          title: z.string().nullable(),
          description: z.string().nullable().optional(),
          url: z.string(),
          publishedAt: z.string(),
        })
        .passthrough(),
    )
    .optional(),
  message: z.string().optional(),
});

/** Business and markets outlets only, so NewsAPI's general firehose stays on-topic. */
const NEWSAPI_DOMAINS = [
  "cnbc.com", "marketwatch.com", "finance.yahoo.com", "fool.com", "businessinsider.com", "barrons.com", "wsj.com", "bloomberg.com",
  "reuters.com", "ft.com", "forbes.com", "thestreet.com", "investopedia.com", "seekingalpha.com", "benzinga.com", "fortune.com", "axios.com",
].join(",");

/**
 * NewsAPI.org /v2/everything over financial outlets, newest first, 100 articles per call. Cached for
 * 30 minutes (≤ 48 calls/day of the developer plan's 100).
 */
export async function newsApiNews(apiKey: string, fetchedAt: string, fetchImpl?: typeof fetch): Promise<RawRecord[]> {
  const from = new Date(Date.parse(fetchedAt) - 3 * 86_400_000).toISOString().slice(0, 10);
  const q = new URLSearchParams({ domains: NEWSAPI_DOMAINS, language: "en", sortBy: "publishedAt", pageSize: "100", from });
  const raw = await providerJson(`https://newsapi.org/v2/everything?${q}`, { provider: "newsapi", ratePerSec: 1, headers: { "X-Api-Key": apiKey }, revalidate: 1800, fetchImpl, attempts: 1 });
  const parsed = NewsApi.safeParse(raw);
  if (!parsed.success) throw new ProviderError("newsapi", "schema", "Unexpected NewsAPI payload shape");
  if (parsed.data.status !== "ok") throw new ProviderError("newsapi", "upstream", parsed.data.message ?? "NewsAPI error");
  return (parsed.data.articles ?? []).flatMap((a, i): RawRecord[] => {
    const url = safeExternalUrl(a.url);
    if (!url || !a.title || a.title === "[Removed]") return [];
    return [
      {
        provider: "newsapi",
        providerId: url || String(i),
        kind: "news",
        url,
        title: sanitizeText(a.title.replace(/\s+-\s+[^-]{2,40}$/, ""), 300),
        excerpt: sanitizeText(a.description ?? "", 400),
        contentScope: "snippet",
        publisher: sanitizeText(a.source?.name ?? "Unknown publisher", 80),
        sourceId: "newsapi",
        publishedAt: iso(a.publishedAt),
        fetchedAt,
        tickers: [],
        isOriginalDisclosure: false,
        isSynthetic: false,
      },
    ];
  });
}
