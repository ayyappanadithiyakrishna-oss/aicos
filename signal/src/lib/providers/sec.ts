/**
 * SEC EDGAR adapter (public data). Follows SEC fair-access guidance: a descriptive User-Agent
 * with contact details is REQUIRED (SEC_USER_AGENT), traffic stays well under 10 requests/second,
 * and responses are cached. The filings feed is a disclosure source, not a consensus feed.
 */
import type { Security } from "@/lib/domain/types";
import type { RawRecord } from "@/lib/ingestion/types";
import { eightKItemInfo } from "@/lib/analysis/extract";
import { sanitizeText } from "@/lib/security/sanitize";
import { ProviderError, providerFetch, providerJson } from "./http";

export const SEC_RATE_PER_SEC = 5;

export function secUserAgent(env: NodeJS.ProcessEnv = process.env): string | null {
  const ua = env.SEC_USER_AGENT?.trim();
  // Must identify the requester with a contact email.
  return ua && /\S+@\S+\.\S+/.test(ua) ? ua : null;
}

export interface SecTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

export async function fetchCompanyTickers(ua: string, fetchImpl?: typeof fetch): Promise<Security[]> {
  const data = await providerJson<Record<string, SecTickerEntry>>("https://www.sec.gov/files/company_tickers.json", {
    provider: "sec",
    ratePerSec: SEC_RATE_PER_SEC,
    headers: { "User-Agent": ua, Accept: "application/json" },
    revalidate: 86_400,
    fetchImpl,
  });
  if (!data || typeof data !== "object") throw new ProviderError("sec", "schema", "company_tickers.json shape changed");
  const out: Security[] = [];
  for (const v of Object.values(data)) {
    if (!v || typeof v.ticker !== "string" || typeof v.cik_str !== "number") continue;
    const cik = String(v.cik_str);
    out.push({
      id: `cik:${cik}`,
      ticker: v.ticker.toUpperCase(),
      name: sanitizeText(v.title, 160),
      kind: "equity",
      exchange: "US",
      currency: "USD",
      sector: "Unclassified",
      industry: "Unclassified",
      marketCapBucket: null,
      beta: null,
      sigmaDaily: null,
      benchmarkId: "live:SPY",
      isSynthetic: false,
      brandingRights: "none",
      tickerHistory: [],
      cik,
    });
  }
  return out;
}

const ITEM_RE = /Item\s+(\d\.\d{2})/g;

export interface ParsedFiling {
  form: string;
  company: string;
  cik: string;
  accession: string;
  acceptedAt: string;
  items: string[];
  link: string;
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/** Minimal Atom parser for the EDGAR "current filings" feed. Unknown shapes are skipped. */
export function parseCurrentFilingsAtom(xml: string): ParsedFiling[] {
  const out: ParsedFiling[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]!;
    const title = decodeEntities(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] ?? "");
    const link = /<link[^>]*href="([^"]+)"/.exec(e)?.[1] ?? "";
    const summary = decodeEntities(/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(e)?.[1] ?? "");
    const updated = /<updated>([^<]+)<\/updated>/.exec(e)?.[1] ?? "";
    const form = /<category[^>]*term="([^"]+)"/.exec(e)?.[1] ?? /^([^ ]+) - /.exec(title)?.[1] ?? "";
    const tm = /^(.+?) - (.+?) \((\d{10})\) \(/.exec(title);
    const acc = /AccNo:<\/b>\s*([\d-]+)/.exec(summary)?.[1] ?? /accession-number=([\d-]+)/.exec(e)?.[1] ?? "";
    if (!tm || !acc || !updated || !Number.isFinite(Date.parse(updated))) continue;
    const items = [...summary.matchAll(ITEM_RE)].map((x) => x[1]!);
    out.push({
      form: form.trim(),
      company: sanitizeText(tm[2], 160),
      cik: tm[3]!.replace(/^0+/, ""),
      accession: acc,
      acceptedAt: new Date(updated).toISOString(),
      items: [...new Set(items)],
      link: link.startsWith("https://www.sec.gov/") ? link : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${tm[3]}`,
    });
  }
  return out;
}

export function filingToRecord(f: ParsedFiling, fetchedAt: string): RawRecord {
  const info = f.form.startsWith("8-K") ? eightKItemInfo(f.items) : null;
  const what = info ? `Item ${info.item} (${info.label})` : f.items.length ? `Items ${f.items.join(", ")}` : `Form ${f.form}`;
  return {
    provider: "sec",
    providerId: f.accession,
    kind: "filing",
    url: f.link,
    title: `${f.company} files ${f.form}: ${what}`,
    excerpt: `${f.company} filed Form ${f.form} with the SEC${f.items.length ? ` reporting Items ${f.items.join(", ")}` : ""}. Accession ${f.accession}.`,
    contentScope: "title_only",
    publisher: "SEC EDGAR",
    sourceId: "sec-edgar",
    publishedAt: f.acceptedAt,
    fetchedAt,
    tickers: [],
    isOriginalDisclosure: true,
    isSynthetic: false,
    structured: { filing: { form: f.form, items: f.items, cik: f.cik, accession: f.accession, acceptedAt: f.acceptedAt, isAmendment: f.form.endsWith("/A"), amends: null } },
    internalPath: null,
  };
}

export async function fetchCurrentFilings(ua: string, opts: { form?: string; count?: number; fetchImpl?: typeof fetch } = {}): Promise<ParsedFiling[]> {
  const form = opts.form ?? "8-K";
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(form)}&company=&dateb=&owner=include&start=0&count=${opts.count ?? 100}&output=atom`;
  const res = await providerFetch(url, { provider: "sec", ratePerSec: SEC_RATE_PER_SEC, headers: { "User-Agent": ua, Accept: "application/atom+xml" }, revalidate: 300, fetchImpl: opts.fetchImpl });
  const text = await res.text();
  if (!text.includes("<feed")) throw new ProviderError("sec", "schema", "Current filings response was not an Atom feed");
  return parseCurrentFilingsAtom(text);
}
