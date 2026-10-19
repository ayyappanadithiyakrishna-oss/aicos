"use client";
import { useEffect, useState } from "react";
import type { EodImpliedMove } from "@/lib/quant/options";

type Payload = EodImpliedMove & { ticker?: string; spot?: number };

const cache = new Map<string, Promise<Payload>>();
function load(ticker: string): Promise<Payload> {
  let p = cache.get(ticker);
  if (!p) {
    p = fetch(`/api/options/${encodeURIComponent(ticker)}`)
      .then((r) => r.json() as Promise<Payload>)
      .catch(() => ({ available: false as const, reason: "Options data could not be loaded." }));
    cache.set(ticker, p);
  }
  return p;
}

export function useImpliedMove(ticker: string, enabled = true) {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    load(ticker).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [ticker, enabled]);
  return data;
}

const fmt = (n: number, dp = 2) => n.toFixed(dp);

/** Ticker cockpit panel: market-priced magnitude from the ATM straddle, compared with the model view. */
export function ImpliedMovePanel({ ticker, modelSessionSigmaPct }: { ticker: string; modelSessionSigmaPct: number | null }) {
  const d = useImpliedMove(ticker);
  if (!d) {
    return (
      <div aria-busy="true" className="space-y-2">
        <div className="skeleton h-7 w-24" />
        <div className="skeleton h-3 w-48" />
        <p className="text-2xs text-ink-3">Loading end-of-day options (Massive allows 5 requests a minute).</p>
      </div>
    );
  }
  if (!d.available) return <p className="text-xs text-ink-3">{d.reason}</p>;
  const ratio = modelSessionSigmaPct && modelSessionSigmaPct > 0 ? d.sessionSigmaPct / modelSessionSigmaPct : null;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <div>
          <div className="num text-2xl font-semibold text-ink">±{fmt(d.movePct)}%</div>
          <div className="text-2xs text-ink-3">by {new Date(`${d.expiry}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} expiry · {d.tradingDays} sessions</div>
        </div>
        <div>
          <div className="num text-lg font-medium text-ink">±{fmt(d.sessionSigmaPct)}%</div>
          <div className="text-2xs text-ink-3">1σ per session</div>
        </div>
        <div>
          <div className="num text-lg font-medium text-ink">{fmt(d.ivAnnualPct, 1)}%</div>
          <div className="text-2xs text-ink-3">implied vol (annualized)</div>
        </div>
      </div>
      {ratio !== null ? (
        <p className="mt-3 text-xs text-ink-2">
          Options price {ratio >= 1 ? `${fmt(ratio, 1)}× more` : `${fmt(1 / ratio, 1)}× less`} daily movement than this stock&apos;s trailing 60-session volatility ({fmt(modelSessionSigmaPct!)}%) — the model&apos;s scale.
          {ratio >= 1.5 ? " The market expects an unusually large move (often a scheduled catalyst)." : ratio <= 0.75 ? " The market expects calmer trading than recent history." : ""}
        </p>
      ) : null}
      <ul className="mt-3 space-y-0.5 text-2xs text-ink-3">
        {d.assumptions.map((a) => (
          <li key={a}>· {a}</li>
        ))}
      </ul>
      <p className="mt-1.5 text-2xs text-ink-3">Source: {d.source}. Magnitude only, not a direction.</p>
    </div>
  );
}

/** One line for popovers: loads only when rendered (i.e. when the popover opens). */
export function ImpliedLine({ ticker, centralPct }: { ticker: string; centralPct: number | null }) {
  const d = useImpliedMove(ticker);
  if (!d || !d.available) return null;
  const vs = centralPct !== null ? Math.abs(centralPct) / d.sessionSigmaPct : null;
  return (
    <p className="mt-2 text-xs text-ink-2">
      <span className="text-ink-3">Options imply</span> <span className="num font-medium text-ink">±{d.sessionSigmaPct.toFixed(2)}%</span> per session (1σ), ±{d.movePct.toFixed(1)}% by {d.expiry}.
      {vs !== null ? ` The model's estimate is ${vs.toFixed(2)}σ of that.` : ""}
    </p>
  );
}
