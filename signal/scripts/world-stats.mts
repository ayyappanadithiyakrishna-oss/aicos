import { getDemoWorld, demoScorecard } from "../src/lib/demo/world";

const t0 = performance.now();
const w = await getDemoWorld();
console.log("build ms", Math.round(performance.now() - t0), "world.buildMs", w.buildMs, "pipeline ms", w.pipeline.ms);
console.log("history events", w.history.length, "archive", w.archive.length, "rows", w.scorecardRows.length);
for (const [h, m] of Object.entries(w.model.horizons)) console.log(h, { trainN: m!.trainN, calN: m!.calN, cov: m!.calibrationCoverage, ece: m!.calibrationEce, calibrated: m!.calibrated, lambda: m!.prior.lambda, note: m!.calibrationNote });
console.log("stages", w.pipeline.stages.map((s) => `${s.stage}:${s.count}`).join(" "), "dead", w.pipeline.deadLetters, "quarantined", w.pipeline.quarantined.length, "dupes", w.pipeline.skippedDuplicates, "superseded", w.pipeline.superseded.length);
for (const e of w.events) {
  const ns = e.forecasts.filter((f) => f.horizon === "next_session");
  console.log(`\n[${e.relevance.score}] ${e.subtype} ${e.severity} q=${e.quality.score} arts=${e.articleIds.length} echo=${e.novelty.echoCount} ovl=${e.overlapping}`);
  console.log("  BL:", e.bottomLine, `(${e.bottomLine.split(/\s+/).length}w)`);
  console.log("  facts:", e.verifiedFacts.map((f) => f.text).join(" | "));
  console.log("  chain:", e.transmission.join(" → "));
  for (const f of ns) console.log(`   ${f.ticker.padEnd(5)} ${f.direction.padEnd(12)} ${f.qualityTier.padEnd(14)} c=${f.centralMovePct} [${f.intervalLowPct},${f.intervalHighPct}] p=${JSON.stringify(f.probabilities)} n=${f.nEff} ${f.reasonCodes.join(",")} rev=${f.revision}`);
  const rz = e.realizations.filter((r) => r.status === "resolved").length;
  console.log("  realizations resolved:", rz, "/", e.realizations.length, "limits:", e.limitations.join(" ; "));
}
const sc = demoScorecard(w);
console.log("\nOOS", sc.counts, "acc", sc.oos.directionalAccuracy, "cov", sc.oos.coverage80.value, "brier", sc.oos.brier.value, "clim", sc.oos.brierClimatology.value, "mae", sc.oos.mae.value, "maeZero", sc.oos.maeZero.value, "maePrior", sc.oos.maeEventPrior.value);
for (const s of sc.byHorizon) console.log(" ", s.key, s.n, "acc", s.directionalAccuracy.value?.toFixed(3), "cov", s.coverage80.value?.toFixed(3), "brier", s.brier.value?.toFixed(3), s.brierClimatology.value?.toFixed(3));
