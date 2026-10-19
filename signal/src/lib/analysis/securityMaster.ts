/**
 * Security master: canonical IDs, point-in-time ticker history, documented relationships and
 * index memberships. All ticker linkage flows through here; anything it cannot verify is
 * quarantined with a reason instead of being shown.
 */
import type { QuarantinedSymbol, Security } from "@/lib/domain/types";

export interface DocumentedRelationship {
  fromId: string;
  toId: string;
  kind: "supplier" | "customer" | "competitor";
  /** Human-readable evidence and where it came from (filing, company disclosure, licensed dataset). */
  evidence: string;
  evidencePath: string | null;
  asOf: string;
}

export interface IndexMembership {
  etfId: string;
  memberId: string;
  weight: number;
  asOf: string;
  source: string;
}

export interface CandidateSymbol {
  symbol: string;
  how: "cashtag" | "exchange_qualified" | "provider_tag" | "name_alias" | "bare";
}

/** Uppercase words that collide with tickers; never linked without a cashtag or exchange prefix. */
const AMBIGUOUS = new Set(
  "A AI ALL AM AN ARE AS AT BE BIG CAN CEO CFO DD EPS ETF FDA FOR FED GDP GO HAS IPO IT M&A NEW NOW ON ONE OR OUT PM SEC SO THE TV UK US USA YOY CPI PCE PMI AND".split(" "),
);

export class SecurityMaster {
  private readonly byIdMap = new Map<string, Security>();
  private readonly byCikMap = new Map<string, Security>();
  private readonly aliasMap = new Map<string, string>();
  private readonly byPlainTicker = new Map<string, Security>();

  constructor(
    readonly securities: readonly Security[],
    readonly relationships: readonly DocumentedRelationship[] = [],
    readonly memberships: readonly IndexMembership[] = [],
    aliases: Record<string, string> = {},
    /** Link bare uppercase words that equal a ticker. Off for large live directories (too many false hits). */
    readonly allowBare = true,
  ) {
    for (const s of securities) {
      this.byIdMap.set(s.id, s);
      if (!s.tickerHistory.length && !this.byPlainTicker.has(s.ticker)) this.byPlainTicker.set(s.ticker, s);
      if (s.cik) this.byCikMap.set(s.cik.replace(/^0+/, ""), s);
    }
    for (const [alias, id] of Object.entries(aliases)) this.aliasMap.set(alias.toLowerCase(), id);
  }

  byId(id: string): Security | null {
    return this.byIdMap.get(id) ?? null;
  }

  byCik(cik: string): Security | null {
    return this.byCikMap.get(cik.replace(/^0+/, "")) ?? null;
  }

  /** Resolve a ticker as it was valid at `at` (ticker history aware). */
  byTicker(ticker: string, at?: string): Security | null {
    const t = ticker.toUpperCase();
    const when = at ? Date.parse(at) : Number.POSITIVE_INFINITY;
    const plain = this.byPlainTicker.get(t);
    if (plain) return plain;
    for (const s of this.securities) {
      if (!s.tickerHistory.length) continue;
      if (s.tickerHistory.length) {
        for (const h of s.tickerHistory) {
          const from = Date.parse(h.from);
          const to = h.to ? Date.parse(h.to) : Number.POSITIVE_INFINITY;
          if (h.ticker === t && when >= from && when < to) return s;
        }
      }
    }
    return null;
  }

  /** True if the symbol exists in history but was not valid at `at`. */
  tickerValidElsewhere(ticker: string): boolean {
    const t = ticker.toUpperCase();
    return this.securities.some((s) => s.ticker === t || s.tickerHistory.some((h) => h.ticker === t));
  }

  relationsOf(issuerId: string): DocumentedRelationship[] {
    return this.relationships.filter((r) => r.fromId === issuerId);
  }

  etfsContaining(memberId: string): IndexMembership[] {
    return this.memberships.filter((m) => m.memberId === memberId).sort((a, b) => b.weight - a.weight);
  }

  sectorProxy(sector: string): Security | null {
    return this.securities.find((s) => s.kind === "etf" && s.sector === sector && s.industry === "Sector ETF") ?? null;
  }

  benchmark(): Security | null {
    return this.securities.find((s) => s.industry === "Broad market") ?? null;
  }

  extractCandidates(text: string, providerTickers: readonly string[]): CandidateSymbol[] {
    const out = new Map<string, CandidateSymbol>();
    const add = (symbol: string, how: CandidateSymbol["how"]) => {
      const s = symbol.toUpperCase();
      const prev = out.get(s);
      const rank = { cashtag: 4, exchange_qualified: 4, name_alias: 3, provider_tag: 2, bare: 1 } as const;
      if (!prev || rank[how] > rank[prev.how]) out.set(s, { symbol: s, how });
    };
    for (const m of text.matchAll(/\$([A-Z]{1,5}(?:\.[A-Z])?)\b/g)) add(m[1]!, "cashtag");
    for (const m of text.matchAll(/\((?:NYSE|NASDAQ|Nasdaq|NYSE American|NYSE Arca|CBOE)\s*:\s*([A-Z]{1,5}(?:\.[A-Z])?)\)/g)) add(m[1]!, "exchange_qualified");
    for (const t of providerTickers) add(t, "provider_tag");
    const lower = text.toLowerCase();
    for (const [alias, id] of this.aliasMap) {
      if (new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)) {
        const sec = this.byId(id);
        if (sec) add(sec.ticker, "name_alias");
      }
    }
    if (this.allowBare) for (const m of text.matchAll(/\b([A-Z]{2,5})\b/g)) {
      const s = m[1]!;
      if (this.byTicker(s) && !out.has(s)) add(s, "bare");
    }
    return [...out.values()];
  }

  /**
   * Verify candidates against the master and the article text.
   * Returns verified securities and quarantined symbols with reasons.
   */
  resolve(
    text: string,
    providerTickers: readonly string[],
    at: string,
    articleId: string | null,
  ): { verified: Array<{ security: Security; how: CandidateSymbol["how"] }>; quarantined: QuarantinedSymbol[] } {
    const verified: Array<{ security: Security; how: CandidateSymbol["how"] }> = [];
    const quarantined: QuarantinedSymbol[] = [];
    const lower = text.toLowerCase();
    for (const c of this.extractCandidates(text, providerTickers)) {
      const sec = this.byTicker(c.symbol, at);
      if (!sec) {
        const reason = this.tickerValidElsewhere(c.symbol)
          ? "Ticker not valid at publication time (symbol change)"
          : "Unknown symbol: not in security master";
        quarantined.push({ symbol: c.symbol, reason, articleId });
        continue;
      }
      if (c.how === "bare" && AMBIGUOUS.has(c.symbol)) {
        quarantined.push({ symbol: c.symbol, reason: "Ambiguous bare symbol without cashtag or exchange prefix", articleId });
        continue;
      }
      if (c.how === "provider_tag") {
        const mentioned =
          new RegExp(`\\b${c.symbol}\\b`).test(text) ||
          lower.includes(sec.name.toLowerCase().split(" ")[0]!.toLowerCase());
        if (!mentioned) {
          quarantined.push({ symbol: c.symbol, reason: "Provider tag not supported by article text", articleId });
          continue;
        }
      }
      verified.push({ security: sec, how: c.how });
    }
    return { verified, quarantined };
  }
}
