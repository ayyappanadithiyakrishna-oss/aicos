# Quantitative methodology

## Targets and windows
* Log returns `r = ln(P_end / P_start)` in percent, on **regular-session** prices.
* Abnormal return `AR = r_i − β_i · r_benchmark`, β from 120 past daily returns (point-in-time).
* Horizons: **1 trading hour**, **next session close** (close of the first regular session ending after
  publication, "day 0"), **5 sessions** (day 0 counts as session 1). Publications outside regular hours
  use the prior regular close as baseline, so pre/post-market reaction is inside the window.
* NYSE calendar: rule-based holidays + early closes + unscheduled closures, verified in tests against
  the exchange's 2025–2027 schedule.

## Model (per horizon)
1. **Standardize**: `y = AR / σ_h`, σ_h = past-only 60-day daily vol × √(trading days in horizon).
2. **Hierarchical shrinkage prior** over the path `subtype → subtype|channel:sign → …|magnitude`:
   `μ_level = w·μ_group + (1−w)·μ_parent`, `w = n/(n+λ)`. λ chosen from `{1,2,5,10,20,50,100}` by
   validation MSE on the last 20 % of the training window. Levels with n < 8 back off to the parent; a
   numeric estimate requires channel-level support (depth ≥ 2).
3. **Split-conformal 80 % interval** from residual quantiles on calibration split A (finite-sample
   corrected), rescaled by σ_h. Coverage is measured, not assumed.
4. **Class probabilities** with fixed bands — up `y > +0.5`, down `y < −0.5`, else "no material move" —
   from the residual distribution, then **isotonic-calibrated** on calibration split B, floored to
   [2 %, 96 %] after normalization via affine shrinkage. An untouched chronological holdout C
   judges both interval coverage and post-isotonic probabilities. Requirements: ≥150 unique
   calibration events, ≥30 unique holdout events, coverage within 0.80 ± 0.07, maximum class ECE
   ≤0.12, and multiclass Brier no worse than training climatology. Group support must also
   be n ≥25. Calibration A/B/C use the first 50%, next 25%, final 25% of the calibration period.
5. **Splits are chronological and purged**: an example is used in a split only if its outcome window
   ends before the next boundary (no leakage across train/calibration/test).

## Quality tiers and abstention
`calibrated` → `evaluated` (central + interval, probabilities withheld) → `direction_only` →
`insufficient`. Reason codes: `NO_PRICE_HISTORY`, `NO_BASELINE_PRICE`, `SYMBOL_MAPPING_DOUBT`,
`UNVERIFIED_NUMERIC_FACTS`, `STALE_PROVIDER`, `NO_TRAINED_MODEL`, `NO_COMPARABLE_HISTORY`,
`SPARSE_GROUP`, `SOURCE_CONFLICT`, `EVENT_OVERLAP` (probabilities withheld), `BELOW_NOISE`
(|μ| < 0.2σ: central suppressed), `UNCALIBRATED_PROBABILITIES`.

Every snapshot is validated: interval ordering, central inside interval, probability bounds and unit sum
(±1e-6), calibrated-only probabilities, abstentions carry no numbers, magnitude bounds per horizon,
`asOf ≤ generatedAt`, `baselinePriceTime ≤ asOf`. The same rules are Postgres CHECK constraints.

## Evaluation (scorecard)
Walk-forward: six quarterly folds; each trains on data ending 6 months before the fold, calibrates on
the following 6 months, and forecasts the fold. Reported out-of-sample (and in-sample for contrast only):
3-class directional accuracy, bullish/bearish hit rates, confusion matrix, multi-class Brier vs a
climatology baseline, log loss, 80 % coverage, MAE and bias of the central estimate, MAE of three
baselines (zero return, event-type prior, market-beta), reliability curve + ECE, slices by horizon,
event type, sector and regime, 90 % bootstrap CIs (fixed seed). Any metric below `MIN_METRIC_SAMPLE`
(default 30) is shown as **insufficient sample**.

## Demo results (synthetic — not evidence of skill)
On the synthetic DGP the walk-forward OOS next-session model reaches ~51 % 3-class accuracy with
Brier 0.62 vs 0.66 climatology and ~82 % interval coverage; the 5-session model shows **no** Brier
improvement over climatology. These figures only demonstrate that the machinery measures what it should.

## Separate quantities
* **Options-implied range**: `S·σ·√(d/252)` or 0.8 × ATM straddle, only from an entitled, fresh chain;
  magnitude only, never a direction. Not available in this build.
* **Priced-in**: pre-event drift, observed move since publication, and modeled remaining move are
  separate; remaining move is "not estimable" without a model conditioned on realized prices.
* **Market Pulse** shows observed moves and hypothesis links — no additive causal waterfall.

## Live audit (2026-10-18)

The previous artifact evaluated calibration on fitting examples. It has been replaced by a
chronological holdout model, with outcome windows purged at every boundary. Both live horizons
currently fail the baseline probability gate, so numeric probabilities are withheld. This is
historical validation, not evidence of profitable trading or a verified live track record.
Current-universe selection introduces survivorship bias; reactions within the same market regime
can be correlated, and daily data limits timing precision. Provider-reported options closes must
match the underlying session and the latest completed NYSE session. Missing data is never replaced
by a made-up implied move. Live feed storage remains ephemeral without DATABASE_URL.
