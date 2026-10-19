/** Refit cached resolved history without spending additional provider requests. */
import { readFileSync, writeFileSync } from "node:fs";
import { trainModel, type TrainingExample } from "../src/lib/quant/model";
const target = new URL("../src/lib/live/model.json", import.meta.url);
const previous = JSON.parse(readFileSync(target, "utf8"));
const examples: TrainingExample[] = JSON.parse(readFileSync(new URL(".cache/resolved-examples.json", import.meta.url), "utf8"));
const model = trainModel(examples, {
  version: `erm-holdout-v2-${new Date().toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "")}`,
  trainedAt: new Date().toISOString(),
  trainingCutoff: previous.model.trainingCutoff,
  calibrationEnd: previous.model.calibrationEnd,
  isSynthetic: false,
  horizons: ["next_session", "5_sessions"],
});
writeFileSync(target, JSON.stringify({ model, training: previous.training }) + "\n");
for (const [h, m] of Object.entries(model.horizons)) console.log(h, JSON.stringify({ calibrated: m?.calibrated, coverage: m?.calibrationCoverage, validation: m?.validation, note: m?.calibrationNote }));
