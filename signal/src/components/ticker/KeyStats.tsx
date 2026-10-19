import type { PriceBar } from "@/lib/domain/types";
import { Pct } from "@/components/ui/primitives";
import { num } from "@/lib/format";

const ret = (bars: readonly PriceBar[], n: number) => {
  const last = bars.at(-1);
  const base = bars.at(-1 - n);
  return last && base ? 100 * (last.c / base.c - 1) : null;
};

function Cell({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-ink-3">{label}</dt>
      <dd className="num mt-0.5 text-[15px] font-medium text-ink">{children}</dd>
      {sub ? <dd className="text-2xs text-ink-3">{sub}</dd> : null}
    </div>
  );
}

/** Price-derived statistics, computed from the same bars the charts and the model use. */
export function KeyStats({ daily, sessionSigmaPct, articles, sentiment }: { daily: readonly PriceBar[]; sessionSigmaPct: number | null; articles: number | null; sentiment: { mean: number; n: number } | null }) {
  if (daily.length < 2) return null;
  const year = daily.slice(-252);
  const hi = Math.max(...year.map((b) => b.h));
  const lo = Math.min(...year.map((b) => b.l));
  const last = daily.at(-1)!;
  const pos = hi > lo ? (last.c - lo) / (hi - lo) : null;
  const vol20 = daily.slice(-21, -1).reduce((x, b) => x + b.v, 0) / Math.max(1, Math.min(20, daily.length - 1));
  const relVol = vol20 > 0 ? last.v / vol20 : null;
  const ytdBase = [...daily].reverse().find((b) => b.t.slice(0, 4) < last.t.slice(0, 4));
  return (
    <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-[18px] bg-surface p-4 sm:grid-cols-4 lg:grid-cols-8">
      <Cell label="5 sessions">
        <Pct value={ret(daily, 5)} dp={1} />
      </Cell>
      <Cell label="1 month">
        <Pct value={ret(daily, 21)} dp={1} />
      </Cell>
      <Cell label="3 months">
        <Pct value={ret(daily, 63)} dp={1} />
      </Cell>
      <Cell label="Year to date">
        <Pct value={ytdBase ? 100 * (last.c / ytdBase.c - 1) : null} dp={1} />
      </Cell>
      <Cell label="52-week range" sub={pos !== null ? `${Math.round(pos * 100)}% of range` : undefined}>
        {num(lo)} – {num(hi)}
      </Cell>
      <Cell label="Volume vs 20-day avg">{relVol !== null ? `${relVol.toFixed(2)}×` : "—"}</Cell>
      <Cell label="Daily volatility (60d)">{sessionSigmaPct !== null ? `${sessionSigmaPct.toFixed(2)}%` : "—"}</Cell>
      <Cell label="Latest news · up to 25" sub={sentiment ? `net tone ${sentiment.mean > 0 ? "+" : ""}${sentiment.mean.toFixed(2)}` : undefined}>
        {articles ?? "—"}
      </Cell>
    </dl>
  );
}
