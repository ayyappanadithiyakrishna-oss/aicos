import type { Metadata } from "next";
import { getStatus } from "@/lib/data/service";
import { LICENSE_MATRIX } from "@/lib/licensing/matrix";
import { dateTimeET } from "@/lib/format";
import { Chip, PageHeader, Panel, SectionTitle, Stat } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Data Status" };
export const dynamic = "force-dynamic";

const STATUS_TONE = { active: "pos", synthetic: "warn", not_configured: "muted", license_blocked: "warn", degraded: "warn", down: "neg" } as const;

export default async function StatusPage() {
  const s = await getStatus();
  return (
    <div className="mx-auto max-w-[1320px]">
      <PageHeader
        title="Data status"
        description={s.mode.mode === "demo" ? "Running in DEMO mode: every feed, price and release is synthetic. Live integrations are implemented and switch on with credentials and DEMO_MODE=false." : "Live provider health, feed latency and pipeline runs. Failures are shown, never filled with synthetic data."}
      >
        <Chip tone={s.mode.mode === "demo" ? "warn" : "accent"}>{s.mode.label}</Chip>
      </PageHeader>
      {s.mode.demoReason ? <p className="mb-5 rounded-md border border-warn/40 bg-warn-dim px-3 py-2 text-sm text-warn">{s.mode.demoReason}</p> : null}

      <Panel className="mb-5 p-4">
        <SectionTitle>Providers</SectionTitle>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="text-2xs text-ink-3">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Provider</th>
                <th className="py-2 pr-3 font-medium">Capabilities</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Latency p50 / p95</th>
                <th className="py-2 pr-3 font-medium">Requests / failures</th>
                <th className="py-2 pr-3 font-medium">Circuit</th>
                <th className="py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {s.providers.map((p) => (
                <tr key={p.id} className="border-b border-line/60 align-top">
                  <td className="py-2 pr-3 font-medium text-ink">{p.name}</td>
                  <td className="py-2 pr-3 text-ink-3">{p.capabilities.join(", ")}</td>
                  <td className="py-2 pr-3">
                    <Chip tone={STATUS_TONE[p.status]}>{p.status.replace("_", " ")}</Chip>
                  </td>
                  <td className="num py-2 pr-3 font-mono text-ink-2">{p.latencyP50Ms !== null ? `${p.latencyP50Ms} / ${p.latencyP95Ms} ms` : "—"}</td>
                  <td className="num py-2 pr-3 font-mono text-ink-2">
                    {p.requests} / {p.failures}
                  </td>
                  <td className="py-2 pr-3 text-ink-2">{p.circuit}</td>
                  <td className="py-2 text-ink-3">
                    {p.note}
                    {p.lastError ? <div className="text-neg">Last error: {p.lastError}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Panel className="p-4">
          <SectionTitle>Feed freshness</SectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Last ingest" value={s.freshness.lastIngestAt ? dateTimeET(s.freshness.lastIngestAt) : "—"} />
            <Stat label="Newest item" value={s.freshness.newestItemAt ? dateTimeET(s.freshness.newestItemAt) : "—"} />
            <Stat label="Ingest lag p50" value={s.freshness.ingestLagP50Min !== null ? `${s.freshness.ingestLagP50Min} min` : "—"} />
            <Stat label="Ingest lag p95" value={s.freshness.ingestLagP95Min !== null ? `${s.freshness.ingestLagP95Min} min` : "—"} />
          </div>
          <p className="mt-3 text-2xs text-ink-3">{s.freshness.note}</p>
          {s.freshness.stale ? <p className="mt-2 text-xs text-warn">Feed is stale — treat content as delayed.</p> : null}
        </Panel>
        <Panel className="p-4 lg:col-span-2">
          <SectionTitle>Pipeline run {s.pipeline.ranAt ? `· ${dateTimeET(s.pipeline.ranAt)}` : ""}</SectionTitle>
          {s.pipeline.stages.length ? (
            <ol className="flex flex-wrap gap-1.5">
              {s.pipeline.stages.map((st, i) => (
                <li key={i} className="rounded-md border border-line bg-surface-2 px-2 py-1 text-2xs">
                  <span className="text-ink-2">{st.stage.replace("_", " ")}</span>{" "}
                  <span className={st.status === "ok" ? "text-pos" : "text-neg"}>{st.status}</span> <span className="num font-mono text-ink-3">{st.count} · {st.ms}ms</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-ink-3">No pipeline run recorded on this instance.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-6">
            <Stat label="Duplicates skipped" value={s.pipeline.skippedDuplicates} />
            <Stat label="License-blocked records" value={s.pipeline.licenseBlocked} />
            <Stat label="Dead letters" value={s.pipeline.deadLetters.length} tone={s.pipeline.deadLetters.length ? "warn" : "ink"} />
            <Stat label="Quarantined symbols" value={s.pipeline.quarantined.length} tone={s.pipeline.quarantined.length ? "warn" : "ink"} />
          </div>
          {s.pipeline.quarantined.length ? (
            <ul className="mt-2 text-2xs text-ink-3">
              {s.pipeline.quarantined.map((q, i) => (
                <li key={i}>
                  <span className="font-mono text-warn">{q.symbol}</span> — {q.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {s.pipeline.deadLetters.length ? (
            <ul className="mt-2 text-2xs text-neg">
              {s.pipeline.deadLetters.map((d, i) => (
                <li key={i}>
                  {d.stage}: {d.error}
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      </div>

      <Panel className="mb-5 p-4">
        <SectionTitle>Model</SectionTitle>
        {s.model ? (
          <div>
            <p className="text-sm text-ink-2">
              <span className="font-mono text-ink">{s.model.version}</span> · {s.model.methodology}
              {s.model.isSynthetic ? <span className="text-warn"> · trained on synthetic history</span> : null}
            </p>
            <p className="mt-1 text-2xs text-ink-3">
              Training cutoff {s.model.trainingCutoff?.slice(0, 10)} · calibration window to {s.model.calibrationEnd?.slice(0, 10)} · no future data used (purged splits)
            </p>
            <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="text-2xs text-ink-3">
                  <tr className="border-b border-line">
                    <th className="py-1.5 pr-3 font-medium">Horizon</th>
                    <th className="py-1.5 pr-3 font-medium">Train n</th>
                    <th className="py-1.5 pr-3 font-medium">Calibration n</th>
                    <th className="py-1.5 pr-3 font-medium">λ (validated)</th>
                    <th className="py-1.5 pr-3 font-medium">Cal. coverage</th>
                    <th className="py-1.5 pr-3 font-medium">ECE</th>
                    <th className="py-1.5 font-medium">Probabilities</th>
                  </tr>
                </thead>
                <tbody>
                  {s.model.horizons.map((h) => (
                    <tr key={h.horizon} className="border-b border-line/60">
                      <td className="py-1.5 pr-3 font-mono">{h.horizon}</td>
                      <td className="num py-1.5 pr-3 font-mono">{h.trainN}</td>
                      <td className="num py-1.5 pr-3 font-mono">{h.calN}</td>
                      <td className="num py-1.5 pr-3 font-mono">{h.lambda}</td>
                      <td className="num py-1.5 pr-3 font-mono">{h.coverage !== null ? `${(h.coverage * 100).toFixed(1)}%` : "—"}</td>
                      <td className="num py-1.5 pr-3 font-mono">{h.ece?.toFixed(3) ?? "—"}</td>
                      <td className="py-1.5 text-ink-2">{h.calibrated ? "Calibrated" : "Withheld"} <span className="text-2xs text-ink-3">· {h.note}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-2">No model trained on licensed point-in-time history is deployed. Live forecasts are direction-only or abstain; probabilities are disabled until a model passes out-of-sample calibration.</p>
        )}
      </Panel>

      <Panel className="mb-5 p-4">
        <SectionTitle>Jobs</SectionTitle>
        {s.jobs.length ? (
          <ul className="space-y-1 text-xs">
            {s.jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap gap-x-3">
                <span className="font-mono text-ink-2">{j.kind}</span>
                <Chip tone={j.status === "ok" ? "pos" : j.status === "running" ? "accent" : "warn"}>{j.status}</Chip>
                <span className="num font-mono text-ink-3">{dateTimeET(j.startedAt)}</span>
                <span className="text-ink-3">{j.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">No jobs recorded.</p>
        )}
        <p className="mt-2 text-2xs text-ink-3">Scheduled via Vercel Cron (authenticated with CRON_SECRET). On the Hobby plan cron runs at most once per day, so near-real-time ingestion needs Pro (per-minute cron) or an external scheduler.</p>
      </Panel>

      <Panel className="p-4">
        <SectionTitle>Data licensing matrix</SectionTitle>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="text-2xs text-ink-3">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Provider</th>
                <th className="py-2 pr-3 font-medium">Data</th>
                <th className="py-2 pr-3 font-medium">Public display</th>
                <th className="py-2 pr-3 font-medium">Derived use</th>
                <th className="py-2 font-medium">How SIGNAL enforces it</th>
              </tr>
            </thead>
            <tbody>
              {LICENSE_MATRIX.map((r) => (
                <tr key={r.provider} className="border-b border-line/60 align-top">
                  <td className="py-2 pr-3 font-medium text-ink">{r.provider}</td>
                  <td className="py-2 pr-3 text-ink-2">{r.data}</td>
                  <td className="py-2 pr-3 text-ink-2">{r.publicDisplay}</td>
                  <td className="py-2 pr-3 text-ink-2">{r.derivedUse}</td>
                  <td className="py-2 text-ink-3">{r.enforcement}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
