import { describe, expect, it } from "vitest";
import { marketauxNews, massiveToRecords, newsApiNews } from "@/lib/providers/news";
import { impliedMoveFromEodStraddle } from "@/lib/quant/options";

const at = "2026-10-19T12:00:00.000Z";
const fakeFetch = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

describe("news adapters", () => {
  it("maps Massive news with ticker tags and per-ticker sentiment", () => {
    const { records, next } = massiveToRecords(
      {
        results: [
          { id: "a1", article_url: "https://example.com/a", title: "Apple beats", description: "d", published_utc: "2026-10-18T10:00:00Z", tickers: ["aapl"], publisher: { name: "Wire" }, insights: [{ ticker: "AAPL", sentiment: "positive", sentiment_reasoning: "Strong iPhone demand" }] },
        ],
        next_url: "https://api.massive.com/v2/reference/news?cursor=x",
      },
      at,
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.tickers).toEqual(["AAPL"]);
    expect(records[0]!.vendorSentiment).toEqual([{ ticker: "AAPL", score: 1, note: "Strong iPhone demand" }]);
    expect(next).toContain("cursor=x");
  });

  it("maps Marketaux entities to tickers and clamps sentiment", async () => {
    const recs = await marketauxNews(
      "k",
      at,
      {},
      fakeFetch({ data: [{ uuid: "u1", title: "Nvidia rallies", description: "x", url: "https://example.com/n", published_at: "2026-10-18T22:45:45.000000Z", source: "example.com", entities: [{ symbol: "NVDA", type: "equity", sentiment_score: 1.4 }, { symbol: "BTCUSD", type: "cryptocurrency", sentiment_score: 0.2 }] }] }),
    );
    expect(recs[0]!.tickers).toEqual(["NVDA"]);
    expect(recs[0]!.vendorSentiment![0]!.score).toBe(1);
    expect(recs[0]!.sourceId).toBe("marketaux");
  });

  it("drops removed NewsAPI articles and strips trailing outlet names", async () => {
    const recs = await newsApiNews(
      "k",
      at,
      fakeFetch({ status: "ok", articles: [{ source: { name: "CNBC" }, title: "Stocks rise on earnings - CNBC", description: "x", url: "https://www.cnbc.com/a", publishedAt: "2026-10-18T10:00:00Z" }, { source: { name: "X" }, title: "[Removed]", url: "https://removed.com", publishedAt: "2026-10-18T10:00:00Z" }] }),
    );
    expect(recs).toHaveLength(1);
    expect(recs[0]!.title).toBe("Stocks rise on earnings");
  });
});

describe("end-of-day straddle implied move", () => {
  const base = { spot: 100, spotAsOf: at, strike: 100, callClose: 2, putClose: 2, optionsDate: "2026-10-16", expiry: "2026-10-30", tradingDays: 10, contracts: { call: "C", put: "P" }, source: "test" };
  it("derives expected move, per-session sigma and annualized IV", () => {
    const m = impliedMoveFromEodStraddle(base, new Date(at));
    expect(m.available).toBe(true);
    if (!m.available) return;
    expect(m.movePct).toBeCloseTo(4, 6);
    // σ_T = 4 / (0.7979 × 100) = 5.013%; per session = σ_T / √10
    expect(m.sessionSigmaPct).toBeCloseTo(5.0133 / Math.sqrt(10), 3);
    expect(m.ivAnnualPct).toBeCloseTo(m.sessionSigmaPct * Math.sqrt(252), 6);
  });
  it("refuses stale closes and far-from-the-money strikes", () => {
    expect(impliedMoveFromEodStraddle({ ...base, optionsDate: "2026-10-01" }, new Date(at)).available).toBe(false);
    expect(impliedMoveFromEodStraddle({ ...base, strike: 110 }, new Date(at)).available).toBe(false);
  });
});
