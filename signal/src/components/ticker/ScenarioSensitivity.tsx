"use client";
import { useState } from "react";
import type { Security } from "@/lib/domain/types";
import { signedPct } from "@/lib/format";

/**
 * Exploratory what-if using documented factor sensitivities. Linear, partial-equilibrium,
 * no interaction terms — a sensitivity illustration, not a forecast and not advice.
 */
function Slider({ label, value, set, min, max, step, unit, loading }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step: number; unit: string; loading: number | undefined }) {
  return (
    <label className={`block ${loading === undefined ? "opacity-40" : ""}`}>
      <div className="flex items-center justify-between text-2xs">
        <span className="text-ink-3">{label}</span>
        <span className="num font-mono text-ink-2">
          {value > 0 ? "+" : ""}
          {value}
          {unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={loading === undefined} onChange={(e) => set(Number(e.target.value))} className="mt-1 w-full cursor-pointer accent-[var(--accent)]" aria-label={label} />
    </label>
  );
}

export function ScenarioSensitivity({ security }: { security: Security }) {
  const l = security.factorLoadings ?? {};
  const [rates, setRates] = useState(0);
  const [oil, setOil] = useState(0);
  const [usd, setUsd] = useState(0);
  const has = l.ratesPer100bp !== undefined || l.oilPer10pct !== undefined || l.usdPer5pct !== undefined;
  if (!has) {
    return <p className="text-sm text-ink-3">No documented factor sensitivities for {security.ticker}; scenario exploration is unavailable rather than guessed.</p>;
  }
  const impact = (l.ratesPer100bp ?? 0) * (rates / 100) + (l.oilPer10pct ?? 0) * (oil / 10) + (l.usdPer5pct ?? 0) * (usd / 5);
  return (
    <div>
      <div className="space-y-3">
        <Slider label={`Long rates (sensitivity ${l.ratesPer100bp ?? "n/a"}% per +100bp)`} value={rates} set={setRates} min={-100} max={100} step={5} unit="bp" loading={l.ratesPer100bp} />
        <Slider label={`Crude oil (sensitivity ${l.oilPer10pct ?? "n/a"}% per +10%)`} value={oil} set={setOil} min={-30} max={30} step={1} unit="%" loading={l.oilPer10pct} />
        <Slider label={`US dollar (sensitivity ${l.usdPer5pct ?? "n/a"}% per +5%)`} value={usd} set={setUsd} min={-10} max={10} step={0.5} unit="%" loading={l.usdPer5pct} />
      </div>
      <div className="mt-3 flex items-baseline justify-between rounded-md border border-line bg-surface-2 px-3 py-2">
        <span className="text-xs text-ink-3">Illustrative first-order effect</span>
        <span className={`num font-mono text-md ${impact > 0 ? "text-pos" : impact < 0 ? "text-neg" : "text-ink-2"}`}>{signedPct(impact)}</span>
      </div>
      <p className="mt-2 text-2xs text-ink-3">
        Exploratory sensitivity from {security.loadingsVerified === false ? "approximate, unverified" : security.isSynthetic ? "synthetic documented" : "documented"} factor loadings. Linear, no second-round effects, not a forecast and not investment advice.
      </p>
    </div>
  );
}
