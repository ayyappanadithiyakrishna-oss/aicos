/* Unit test for the canonical risk formulas. Run with:  node scripts/test-paper-math.ts
   Asserts the only two permitted formulas against the NBIS @ $251 reference. */
import { stopLoss, takeProfit } from "../src/lib/paperTrading.ts";

const TOL = 0.01;
let failed = 0;

function assert(name: string, actual: number, expected: number): void {
  const ok = Math.abs(actual - expected) <= TOL;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (got ${actual}, expected ${expected})`);
  if (!ok) failed += 1;
}

assert("stopLoss(251) === 230.92", stopLoss(251), 230.92);
assert("takeProfit(251) === 311.24", takeProfit(251), 311.24);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll paper-math assertions passed.");
