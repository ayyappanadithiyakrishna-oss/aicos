/**
 * Live price store backed by an entitled vendor (end-of-day bars). Fetches are prefetched before a
 * pipeline run so scoring stays synchronous. No intraday data → 1h horizons abstain.
 */
import type { PriceBar, Security } from "@/lib/domain/types";
import type { PriceStore } from "@/lib/ingestion/priceStore";
import { fmpDailyBars, massiveDailyBars } from "@/lib/providers/vendors";
import { yahooBars } from "@/lib/providers/free";
import { lseBars } from "@/lib/providers/lse";
import type { LiveConfig } from "./registry";
import { priceProvider } from "./registry";

export class LivePriceStore implements PriceStore {
  readonly entitlement: PriceStore["entitlement"];
  readonly delayMinutes: number | null;
  readonly source: string;
  private readonly bars = new Map<string, PriceBar[]>();
  private readonly intra = new Map<string, PriceBar[]>();
  private readonly provider: "lse" | "fmp" | "massive" | "yahoo" | null;

  constructor(private readonly cfg: LiveConfig) {
    this.provider = priceProvider(cfg);
    this.entitlement = this.provider ? "delayed" : "none";
    this.delayMinutes = this.provider ? null : null;
    this.source =
      this.provider === "lse"
        ? "London Strategic Edge candles"
        : this.provider === "fmp"
        ? "Financial Modeling Prep (end-of-day, delayed)"
        : this.provider === "massive"
          ? "Massive aggregates (end-of-day, delayed)"
          : this.provider === "yahoo"
            ? "Yahoo Finance chart data (unofficial, delayed ~15 min)"
            : "No licensed price provider configured";
  }

  async prefetch(securities: readonly Security[], now: Date, limit = 40): Promise<{ fetched: number; errors: string[] }> {
    if (!this.provider) return { fetched: 0, errors: [] };
    const from = new Date(now.getTime() - 400 * 86_400_000).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    const errors: string[] = [];
    let fetched = 0;
    const todo = securities.slice(0, limit).filter((s) => !this.bars.has(s.id));
    // Small concurrency pool: fast enough for a request, polite to free endpoints.
    const worker = async () => {
      for (let s = todo.shift(); s; s = todo.shift()) {
        try {
          if (this.provider === "lse") {
            const b = await lseBars(this.cfg.lseKey!, s.ticker, now).catch(async (e) => {
              // A symbol the vault does not carry falls back to the free chart source.
              if (!this.cfg.free) throw e;
              const sym = s.ticker.replace(".", "-");
              const [daily, intraday] = await Promise.all([yahooBars(sym, "1d"), yahooBars(sym, "30m").catch(() => [])]);
              return { daily, intraday };
            });
            this.bars.set(s.id, b.daily.filter((x) => Date.parse(x.t) <= now.getTime()));
            this.intra.set(s.id, b.intraday.filter((x) => Date.parse(x.t) <= now.getTime()));
          } else if (this.provider === "yahoo") {
            const sym = s.ticker.replace(".", "-");
            const [d, i] = await Promise.all([yahooBars(sym, "1d"), yahooBars(sym, "30m").catch(() => [])]);
            this.bars.set(s.id, d.filter((x) => Date.parse(x.t) <= now.getTime()));
            this.intra.set(s.id, i.filter((x) => Date.parse(x.t) <= now.getTime()));
          } else {
            const b = this.provider === "fmp" ? await fmpDailyBars(this.cfg.fmpKey!, s.ticker, from) : await massiveDailyBars(this.cfg.massiveKey!, s.ticker, from, to);
            this.bars.set(s.id, b.filter((x) => Date.parse(x.t) <= now.getTime()));
          }
          fetched++;
        } catch (e) {
          errors.push(`${s.ticker}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: this.provider === "lse" ? 1 : 6 }, worker));
    return { fetched, errors };
  }

  daily(securityId: string) {
    return this.bars.get(securityId) ?? null;
  }
  intraday(securityId: string) {
    return this.intra.get(securityId) ?? null;
  }
  splits() {
    return [];
  }
}
