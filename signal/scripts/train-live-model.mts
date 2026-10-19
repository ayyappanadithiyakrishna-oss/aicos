/**
 * Trains the live event-reaction model on real history.
 *
 *   npx tsx --conditions=react-server scripts/train-live-model.mts
 *
 * 1. Massive news history for the largest covered companies (vendor ticker tags + sentiment).
 * 2. London Strategic Edge daily bars for every tagged covered ticker and SPY.
 * 3. The production pipeline replays the news in time order; every forecast whose window has
 *    closed is resolved to a realized abnormal return. Those become training examples.
 * 4. trainModel (hierarchical shrinkage + split-conformal intervals + isotonic probabilities),
 *    trained on the earliest 70% of events and calibrated on the latest 30%.
 *
 * Output: src/lib/live/model.json (committed). Requires MASSIVE_API_KEY and LSE_API_KEY.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { PriceBar } from "../src/lib/domain/types";
import type { RawRecord } from "../src/lib/ingestion/types";
import { runPipeline } from "../src/lib/ingestion/pipeline";
import { trainModel, type TrainingExample } from "../src/lib/quant/model";
import { buildLiveMaster } from "../src/lib/live/master";
import { UNIVERSE } from "../src/lib/live/universe";
import { liveConfig, liveSources } from "../src/lib/live/registry";
import { massiveToRecords } from "../src/lib/providers/news";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
}
const MASSIVE = process.env.MASSIVE_API_KEY!;
const LSE = process.env.LSE_API_KEY!;
if (!MASSIVE || !LSE) throw new Error("MASSIVE_API_KEY and LSE_API_KEY are required");

const TOP_N = Number(process.env.TRAIN_TOP_N ?? 40);
const PAGES = Number(process.env.TRAIN_PAGES ?? 2);
const now = new Date();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- 1. News history (Massive Basic: 5 requests/min → one call every 12.5 s)
const tickers = UNIVERSE.filter((s) => !["BRK.A", "GOOG"].includes(s.ticker)).slice(0, TOP_N).map((s) => s.ticker);
const records = new Map<string, RawRecord>();
// Downloads are cached per ticker so re-training after pipeline changes costs no API budget.
const CACHE = new URL("./.cache/", import.meta.url);
mkdirSync(CACHE, { recursive: true });
for (const [i, t] of tickers.entries()) {
  const file = new URL(`massive-news-${t}.json`, CACHE);
  if (existsSync(file)) {
    for (const r of JSON.parse(readFileSync(file, "utf8")) as RawRecord[]) records.set(r.providerId, r);
    continue;
  }
  const mine: RawRecord[] = [];
  const q = new URLSearchParams({ ticker: t, order: "desc", sort: "published_utc", limit: "1000", "published_utc.gte": "2024-06-01", apiKey: MASSIVE });
  let url: string | null = `https://api.massive.com/v2/reference/news?${q}`;
  for (let page = 0; page < PAGES && url; page++) {
    let next: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url);
      if (res.status === 429) {
        await sleep(20_000);
        continue;
      }
      if (res.ok) {
        const out = massiveToRecords(await res.json(), now.toISOString());
        for (const r of out.records) {
          records.set(r.providerId, r);
          mine.push(r);
        }
        next = out.next ? `${out.next}${out.next.includes("apiKey=") ? "" : `&apiKey=${MASSIVE}`}` : null;
      }
      break;
    }
    url = next;
    await sleep(12_600);
  }
  writeFileSync(file, JSON.stringify(mine));
  log(`news ${i + 1}/${tickers.length} ${t}: ${records.size} unique articles`);
}

// ---- 2. Daily bars for covered tickers that appear in the tags
const covered = new Map(UNIVERSE.map((s) => [s.ticker, s]));
const tagged = new Set<string>(["SPY", "QQQ", "IWM", "TLT", "UUP", "XLE", "XLF"]);
for (const r of records.values()) for (const t of r.tickers) if (covered.has(t)) tagged.add(t);
const nyParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", hour: "2-digit", hour12: false });
const closeUtc = (day: string) => {
  const edt = Date.parse(`${day}T20:00:00Z`);
  return Number(nyParts.format(new Date(edt))) % 24 === 16 ? edt : Date.parse(`${day}T21:00:00Z`);
};
const bars = new Map<string, PriceBar[]>();
const queue = [...tagged];
await Promise.all(
  Array.from({ length: 2 }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const file = new URL(`lse-bars-${encodeURIComponent(t)}.json`, CACHE);
      if (existsSync(file)) { bars.set(t, JSON.parse(readFileSync(file, "utf8"))); continue; }
      const res = await fetch(`https://api.londonstrategicedge.com/vault/candles?symbol=${encodeURIComponent(t)}&timeframe=1d&start=2024-06-01&limit=5000`, { headers: { "x-api-key": LSE } });
      if (res.ok) {
        const rows = (await res.json()) as Array<{ ts: string; open: number; high: number; low: number; close: number; volume?: number }>;
        if (Array.isArray(rows)) bars.set(t, rows.map((b) => ({ t: new Date(closeUtc(b.ts.slice(0, 10))).toISOString(), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume ?? 0 })));
      }
      if (bars.has(t)) writeFileSync(file, JSON.stringify(bars.get(t)));
      await sleep(320);
    }
  }),
);
log(`bars for ${bars.size} of ${tagged.size} tickers`);

// ---- 3. Replay through the production pipeline
const master = buildLiveMaster(UNIVERSE);
const idToTicker = new Map(master.securities.map((s) => [s.id, s.ticker]));
const prices = {
  entitlement: "delayed" as const,
  delayMinutes: null,
  source: "London Strategic Edge daily candles",
  daily: (id: string) => bars.get(idToTicker.get(id) ?? "") ?? null,
  intraday: () => null,
  splits: () => [],
};
const cfg = liveConfig();
const sources = new Map(liveSources({ ...cfg, massiveDisplay: true }).map((s) => [s.id, s] as const));
const examples: TrainingExample[] = [];
const ordered = [...records.values()].filter((r) => r.publishedAt).sort((a, b) => a.publishedAt!.localeCompare(b.publishedAt!));
const BATCH = 1500;
for (let i = 0; i < ordered.length; i += BATCH) {
  const batch = ordered.slice(i, i + BATCH);
  await runPipeline(batch, {
    mode: "live",
    master,
    sources,
    model: null,
    prices,
    now,
    providerStale: () => false,
    dropIrrelevant: true,
    onResolved: (x) => {
      if (x.realization.abnormalReturnPct === null || !x.realization.windowEnd) return;
      examples.push({
        eventId: x.eventId,
        securityId: x.securityId,
        at: x.at,
        windowEnd: x.realization.windowEnd,
        horizon: x.horizon,
        path: x.path,
        sigmaHPct: x.sigmaHPct,
        arPct: x.realization.abnormalReturnPct,
        overlapping: x.overlapping,
        sector: x.sector,
        eventKind: x.subtype.split(".")[0] ?? "other",
        regime: "normal",
      });
    },
  });
  log(`pipeline ${Math.min(i + BATCH, ordered.length)}/${ordered.length}: ${examples.length} resolved examples`);
}

// ---- 4. Fit
writeFileSync(new URL("resolved-examples.json", CACHE), JSON.stringify(examples));
const sorted = examples.sort((a, b) => a.at.localeCompare(b.at));
const lastAt = sorted.at(-1)?.at ?? now.toISOString();
const calibrationEnd = new Date(Date.parse(lastAt) + 1).toISOString();
// Time-ordered split: the earliest 70% of events train the prior, the latest 30% calibrate intervals/probabilities.
const trainingCutoff = sorted[Math.floor(sorted.length * 0.7)]?.at ?? lastAt;
const model = trainModel(sorted, {
  version: `erm-holdout-v2-${now.toISOString().slice(0, 10)}`,
  trainedAt: now.toISOString(),
  trainingCutoff,
  calibrationEnd,
  isSynthetic: false,
  horizons: ["next_session", "5_sessions"],
});
const bySubtype: Record<string, number> = {};
for (const e of sorted) if (e.horizon === "next_session") bySubtype[e.path[0] ?? "?"] = (bySubtype[e.path[0] ?? "?"] ?? 0) + 1;
writeFileSync(
  new URL("../src/lib/live/model.json", import.meta.url),
  JSON.stringify({ model, training: { articles: records.size, tickersQueried: tickers.length, pricedTickers: bars.size, examples: sorted.length, firstAt: sorted[0]?.at ?? null, lastAt, bySubtype } }) + "\n",
);
for (const h of ["next_session", "5_sessions"] as const) {
  const m = model.horizons[h];
  log(h, m ? `train ${m.trainN} · cal ${m.calN} · coverage ${m.calibrationCoverage} · calibrated ${m.calibrated} · ${m.calibrationNote}` : "not trained");
}
log("subtypes", bySubtype);
