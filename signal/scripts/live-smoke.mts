import { runLiveIngest } from "../src/lib/live/jobs";
import { MemoryRepository } from "../src/lib/db/repo";

const repo = new MemoryRepository();
const t0 = Date.now();
const r = await runLiveIngest({ now: new Date(), repo, trigger: "admin" });
console.log("ms", Date.now() - t0, r.status, r.reason, r.fetched, r.errors.slice(0, 6), "events", r.events);
const evs = await repo.listEvents(200);
for (const e of evs.slice(0, 25)) console.log(`- [${e.subtype}] ${e.originalTitle.slice(0, 90)} | ${e.exposures.map((x) => `${x.ticker}:${x.relationship}`).join(",")} | ${e.forecasts.filter((f) => f.horizon === "next_session").map((f) => f.qualityTier + "/" + f.direction).join(",")}`);
