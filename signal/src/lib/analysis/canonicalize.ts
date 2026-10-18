import { hashHex } from "@/lib/quant/stats";

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|cmpid|ref|ncid|guccounter|src|cid|yptr)$/i;

/** Canonical URL for dedup: lowercase host, no fragment, no tracking params, sorted query, no trailing slash. */
export function canonicalUrl(input: string): string {
  try {
    const u = new URL(input);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^amp\./, "");
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a], [b]) => a.localeCompare(b));
    u.search = "";
    for (const [k, v] of params) u.searchParams.append(k, v);
    let path = u.pathname.replace(/\/amp\/?$/, "/").replace(/\/+$/, "");
    if (!path) path = "/";
    u.pathname = path;
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
  } catch {
    return input.trim();
  }
}

const STOPWORDS = new Set(
  "a an the of to in on for and or as at by with from is are was were be been its it this that after over amid into says said report reports reported update".split(" "),
);

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"’'`]/g, "")
    .replace(/[^a-z0-9.%$\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(text: string): string[] {
  return normalizeForMatch(text)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Word-bigram shingles for near-duplicate detection. */
export function shingles(text: string): Set<string> {
  const t = tokens(text);
  const out = new Set<string>();
  for (let i = 0; i < t.length; i++) {
    out.add(t[i]!);
    if (i + 1 < t.length) out.add(`${t[i]} ${t[i + 1]}`);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function contentHash(parts: string[]): string {
  return hashHex(parts.map(normalizeForMatch).join("␞"));
}

/** Rough language check: share of ASCII letters. Non-English content is skipped, not mistranslated. */
export function detectLanguage(text: string): "en" | "unknown" {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (!letters.length) return "unknown";
  const ascii = letters.replace(/[^A-Za-z]/g, "").length;
  return ascii / letters.length > 0.9 ? "en" : "unknown";
}
