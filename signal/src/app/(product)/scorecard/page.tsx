import type { Metadata } from "next";
import { getScorecard } from "@/lib/data/service";
import type { Metric, SliceMetrics } from "@/lib/quant/evaluate";
import { DemoChip, EmptyState, PageHeader, Panel, SectionTitle } from "@/components/ui/primitives";
import { DateRange } from "@/components/lab/DateRange";
import { HORIZON_LONG } from "@/lib/format";
import type { Horizon } from "@/lib/domain/types";

export const metadata: Metadata = { title: "Model Scorecard" };

function M({ m, kind = "pct", dp = 1 }: { m: Metric; kind?: "pct" | "num"; dp?: number }) {
  if (m.insufficient || m.value === null) {
    return (
      <span className="text-2xs text-ink-3" title={`n = ${m.n}`}>
        Insufficient sample <span className="num font-mono">(n={m.n})</span>
      </span>
    );
  }
  const v = kind === "pct" ? `${(m.value * 100).toFixed(dp)}%` : m.value.toFixed(3);
  const ci = m.ci ? (kind === "pct" ? `${(m.ci[0] * 100).toFixed(dp)}–${(m.ci[1] * 100).toFixed(dp)}%` : `${m.ci[0].toFixed(3)}–${m.ci[1].toFixed(3)}`) : null;
  return (
    <span className="num font-mono">
      <span className="text-ink">{v}</span>
      {ci ? <span className="ml-1.5 text-2xs text-ink-3">90% CI {ci}</span> : null}
      <span className="ml-1.5 text-2xs text-ink-3">n={m.n}</span>
    </span>
  );
}

function Confusion({ s }: { s: SliceMetrics }) {
  const ks = ["up", "neutral", "down"] as const;
  const max = Math.max(1, ...ks.flatMap((p) => ks.map((a) => s.confusion[p][a])));
  return (
    <table className="text-xs" aria-label="Confusion matrix: predicted rows, actual columns">
      <thead>
        <tr>
          <th className="p-1 text-left text-2xs font-normal text-ink-3">pred ↓ / actual →</th>
          {ks.map((k) => (
            <th key={k} className="p-1 text-2xs font-normal capitalize text-ink-3">
              {k}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ks.map((p) => (
          <tr key={p}>
            <th className="p-1 text-left text-2xs font-normal capitalize text-ink-3">{p}</th>
            {ks.map((a) => {
              const v = s.confusion[p][a];
              return (
                <td key={a} className="num p-0.5 text-center font-mono">
                  <div className="min-w-12 rounded-sm px-2 py-1.5" style={{ background: `color-mix(in oklab, ${p === a ? "var(--pos)" : "var(--neg)"} ${Math.round((v / max) * 38)}%, var(--surface-2))` }}>
                    {v}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Reliability({ s }: { s: SliceMetrics }) {
  if (!s.reliability) return <p className="text-2xs text-ink-3">Reliability diagram needs calibrated probabilistic forecasts (insufficient sample).</p>;
  const W = 220;
  const H = 220;
  const P = 24;
  const sc = (v: number) => P + v * (W - 2 * P);
  const sy = (v: number) => H - P - v * (H - 2 * P);
  const pts = s.reliability.bins.filter((b) => b.n > 0 && b.meanPredicted !== null);
  return (
    <figure>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Reliability of P(up): ECE ${s.reliability.ece?.toFixed(3)}`}>
        <rect x={P} y={P} width={W - 2 * P} height={H - 2 * P} fill="none" stroke="var(--line-2)" />
        <line x1={sc(0)} y1={sy(0)} x2={sc(1)} y2={sy(1)} stroke="var(--ink-3)" strokeDasharray="3 3" />
        <polyline points={pts.map((b) => `${sc(b.meanPredicted!)},${sy(b.observedRate!)}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth={1.6} />
        {pts.map((b, i) => (
          <circle key={i} cx={sc(b.meanPredicted!)} cy={sy(b.observedRate!)} r={Math.min(6, 2 + Math.sqrt(b.n) / 3)} fill="var(--accent)" opacity={0.8}>
            <title>{`predicted ${(b.meanPredicted! * 100).toFixed(0)}% · observed ${(b.observedRate! * 100).toFixed(0)}% · n=${b.n}`}</title>
          </circle>
        ))}
        <text x={W / 2} y={H - 6} fontSize={10} textAnchor="middle" fill="var(--ink-3)">
          predicted P(up)
        </text>
        <text x={8} y={H / 2} fontSize={10} textAnchor="middle" fill="var(--ink-3)" transform={`rotate(-90 8 ${H / 2})`}>
          observed frequency
        </text>
      </svg>
      <figcaption className="text-2xs text-ink-3">Expected calibration error {s.reliability.ece?.toFixed(3) ?? "—"}. Dashed = perfect calibration.</figcaption>
    </figure>
  );
}

function SliceTable({ title, rows }: { title: string; rows: SliceMetrics[] }) {
  return (
    <Panel className="p-4">
      <SectionTitle>{title}</SectionTitle>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-2xs text-ink-3">
            <tr className="border-b border-line">
              <th className="py-1.5 pr-3 font-medium">Slice</th>
              <th className="py-1.5 pr-3 font-medium">n</th>
              <th className="py-1.5 pr-3 font-medium">Directional accuracy</th>
              <th className="py-1.5 pr-3 font-medium">80% coverage</th>
              <th className="py-1.5 pr-3 font-medium">Brier (model / climatology)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line/60">
                <td className="py-1.5 pr-3 text-ink-2">{HORIZON_LONG[r.key as Horizon] ?? r.key}</td>
                <td className="num py-1.5 pr-3 font-mono text-ink-3">{r.n}</td>
                <td className="py-1.5 pr-3">
                  <M m={r.directionalAccuracy} />
                </td>
                <td className="py-1.5 pr-3">
                  <M m={r.coverage80} />
                </td>
                <td className="py-1.5 pr-3">
                  {r.brier.insufficient ? <M m={r.brier} kind="num" /> : <span className="num font-mono text-ink-2">{r.brier.value!.toFixed(3)} / {r.brierClimatology.value?.toFixed(3) ?? "—"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export default async function ScorecardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
  const view = await getScorecard({ from: valid(sp.from), to: valid(sp.to) ? `${sp.to}T23:59:59Z` : undefined });
  const sc = view.scorecard;
  return (
    <div className="mx-auto max-w-[1320px]">
      <PageHeader
        title="Model scorecard"
        description={
          <>
            {view.note} Metrics below {sc?.minSample ?? 30} observations are withheld. Out-of-sample and in-sample results are never mixed.
            {view.mode.mode === "demo" ? <DemoChip className="ml-2" /> : null}
          </>
        }
      >
        <DateRange />
      </PageHeader>
      {!sc || !sc.counts.total ? (
        <EmptyState title="No resolved forecasts yet" body="The scorecard fills in as forecasts mature and are resolved against licensed prices. Until then every metric shows as insufficient sample." />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            {[sc.oos, sc.inSample].map((s) => (
              <Panel key={s.key} className="p-4">
                <SectionTitle>
                  {s.key === "out-of-sample" ? "Out-of-sample (walk-forward)" : "In-sample (training data — for contrast only)"} · n={s.n}
                </SectionTitle>
                <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                  {[
                    ["Directional accuracy (3-class)", <M key="a" m={s.directionalAccuracy} />],
                    ["Bullish-call hit rate", <M key="b" m={s.bullishHitRate} />],
                    ["Bearish-call hit rate", <M key="c" m={s.bearishHitRate} />],
                    ["80% interval coverage", <M key="d" m={s.coverage80} />],
                    ["Brier score (lower is better)", <M key="e" m={s.brier} kind="num" />],
                    ["Brier — climatology baseline", <M key="f" m={s.brierClimatology} kind="num" />],
                    ["Log loss", <M key="g" m={s.logLoss} kind="num" />],
                    ["MAE of central estimate (pp)", <M key="h" m={s.mae} kind="num" />],
                    ["Bias (central − realized, pp)", <M key="i" m={s.bias} kind="num" />],
                    ["MAE — zero-return baseline", <M key="j" m={s.maeZero} kind="num" />],
                    ["MAE — event-type prior baseline", <M key="k" m={s.maeEventPrior} kind="num" />],
                    ["MAE — market-beta baseline (raw)", <M key="l" m={s.maeMarketBeta} kind="num" />],
                  ].map(([k, v]) => (
                    <div key={k as string} className="flex flex-col">
                      <dt className="text-2xs text-ink-3">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)]">
            <Panel className="p-4">
              <SectionTitle>Confusion matrix (OOS)</SectionTitle>
              <Confusion s={sc.oos} />
              <p className="mt-2 max-w-[320px] text-2xs text-ink-3">Classes: up if AR &gt; +0.5σ, down if AR &lt; −0.5σ, else no material move (σ = past-only horizon volatility).</p>
            </Panel>
            <Panel className="p-4">
              <SectionTitle>Calibration of P(up) (OOS)</SectionTitle>
              <Reliability s={sc.oos} />
            </Panel>
          </div>
          <SliceTable title="By horizon" rows={sc.byHorizon} />
          <div className="grid gap-5 xl:grid-cols-2">
            <SliceTable title="By event type" rows={sc.byEventKind} />
            <SliceTable title="By market regime" rows={sc.byRegime} />
          </div>
          <SliceTable title="By sector" rows={sc.bySector} />
          <p className="text-2xs text-ink-3">
            Counts: {sc.counts.oos.toLocaleString()} OOS · {sc.counts.withProbabilities.toLocaleString()} with calibrated probabilities · {sc.counts.withInterval.toLocaleString()} with intervals. Bootstrap confidence intervals use a fixed seed. Model {view.modelVersion ?? "—"}.
          </p>
        </div>
      )}
    </div>
  );
}
