import Link from "next/link";
import type { Horizon } from "@/lib/domain/types";
import type { CardExposure } from "@/lib/data/cards";
import { HORIZON_SHORT, REASON_SHORT, RELATIONSHIP_LABEL, TIER_SHORT, pct, signedPct } from "@/lib/format";
import { DirectionText } from "@/components/ui/primitives";
import { ForecastFigure } from "./ImpactRail";
import { IntervalBar } from "./IntervalBar";

const HS: Horizon[] = ["1h", "next_session", "5_sessions"];

/** Every exposure × horizon with direction, central, interval, probabilities and abstention reasons. */
export function ExposureTable({ exposures }: { exposures: CardExposure[] }) {
  if (!exposures.length) return <p className="text-sm text-ink-3">No defensible exposure identified.</p>;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
      <table className="w-full min-w-[600px] text-left text-xs">
        <caption className="sr-only">Exposures and model-estimated abnormal reactions by horizon</caption>
        <thead className="text-2xs text-ink-3">
          <tr className="border-b border-line">
            <th scope="col" className="py-1.5 pr-3 font-medium">Asset</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Why linked</th>
            {HS.map((h) => (
              <th key={h} scope="col" className="py-1.5 pr-3 font-medium">
                {HORIZON_SHORT[h]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {exposures.map((x) => (
            <tr key={x.securityId} className="border-b border-line/60 align-top">
              <td className="py-2 pr-3">
                <Link href={`/ticker/${x.ticker}`} className="font-mono font-semibold text-ink hover:text-accent">
                  {x.ticker}
                </Link>
                <div className="text-2xs text-ink-3">{x.directness === "direct" ? "Direct" : "Second-order"}</div>
              </td>
              <td className="max-w-[240px] py-2 pr-3 text-ink-2">
                <span className="text-ink-3">{RELATIONSHIP_LABEL[x.relationship]}.</span> {x.mechanism}
              </td>
              {HS.map((h) => {
                const f = x.forecasts[h];
                return (
                  <td key={h} className="py-2 pr-3">
                    {f ? (
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <DirectionText direction={f.direction} short className="text-2xs" />
                          <ForecastFigure f={f} className="text-2xs" />
                        </div>
                        <IntervalBar central={f.central} lo={f.lo} hi={f.hi} band={f.band} direction={f.direction} width={64} label={`${x.ticker} ${h}`} />
                        <div className="num font-mono text-[11px] text-ink-3">{f.lo !== null ? `80%: ${signedPct(f.lo)}…${signedPct(f.hi)}` : TIER_SHORT[f.tier]}</div>
                        {f.probs ? <div className="num font-mono text-[11px] text-ink-3">↑{pct(f.probs.up)} ↓{pct(f.probs.down)} ·{pct(f.probs.neutral)}</div> : null}
                        {f.reasons.filter((r) => r !== "CALIBRATED").length ? <div className="text-[11px] text-ink-3">{f.reasons.filter((r) => r !== "CALIBRATED").map((r) => REASON_SHORT[r] ?? r).join(" · ")}</div> : null}
                        {f.realized?.status === "resolved" ? <div className="num font-mono text-[11px] text-ink-2">Observed {signedPct(f.realized.ar)}</div> : null}
                      </div>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
