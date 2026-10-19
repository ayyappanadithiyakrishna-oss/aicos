import Link from "next/link";
import type { Metadata } from "next";
import { getPulse } from "@/lib/data/service";
import { num, signedPct, timeET } from "@/lib/format";
import { EmptyState, PageHeader, Panel, Pct, SectionTitle, Stat } from "@/components/ui/primitives";
import { PulseLine } from "@/components/charts/PulseLine";

export const metadata: Metadata = { title: "Market Pulse" };
export const revalidate = 60;

export default async function PulsePage() {
  const p = await getPulse();
  const b = p.benchmark;
  const maxSector = Math.max(0.5, ...p.sectors.map((s) => Math.abs(s.changePct ?? 0)));
  return (
    <div className="mx-auto max-w-[1320px]">
      <PageHeader
        title={`Drivers of ${b.ticker} today`}
        description="Observed moves are measured; links from events to prices are labelled hypotheses with observed co-movement — a post-hoc correlation is not a verified cause."
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Panel className="p-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap gap-6">
                <Stat label={`${b.ticker} · ${b.name}`} value={b.last === null ? "—" : num(b.last)} sub={p.mode.mode === "demo" ? "Synthetic benchmark" : p.mode.priceSource} />
                <Stat label="Session change" value={<Pct value={b.changePct} dp={2} />} sub={b.prevClose !== null ? `prior close ${num(b.prevClose)}` : undefined} />
                {p.breadth ? <Stat label="Breadth (adv / dec / flat)" value={`${p.breadth.advancers} / ${p.breadth.decliners} / ${p.breadth.unchanged}`} sub={p.breadth.note} /> : <Stat label="Breadth" value="—" sub="Needs an entitled constituent feed" />}
              </div>
            </div>
            <div className="mt-4">
              {b.intraday.length ? (
                <PulseLine bars={b.intraday} prevClose={b.prevClose} markers={p.drivers.map((d) => ({ at: d.at, label: d.title }))} />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-line-2 text-sm text-ink-3">No intraday entitlement — session path unavailable.</div>
              )}
            </div>
          </Panel>

          <Panel className="p-4">
            <SectionTitle>Timeline of today’s catalysts and matched reactions</SectionTitle>
            {p.drivers.length ? (
              <ol className="space-y-4">
                {p.drivers.map((d) => (
                  <li key={d.eventId} className="grid gap-1 sm:grid-cols-[80px_minmax(0,1fr)]">
                    <div className="num font-mono text-xs text-ink-3">{timeET(d.at)}</div>
                    <div className="min-w-0">
                      <Link href={`/events/${d.eventId}`} className="font-serif text-md text-ink hover:text-accent-strong">
                        {d.bottomLine}
                      </Link>
                      <p className="mt-1 text-2xs text-ink-3">
                        <span className="font-mono">Hypothesis</span> · {d.hypothesis}
                      </p>
                      {d.observed.length ? (
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          <span className="font-mono text-[11px] text-ink-3">Observed since publication</span>
                          {d.observed.map((o) => (
                            <span key={o.ticker} className="inline-flex items-center gap-1.5">
                              <Link href={`/ticker/${o.ticker}`} className="font-mono font-semibold text-ink hover:text-accent">
                                {o.ticker}
                              </Link>
                              <Pct value={o.changePct} dp={2} />
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="No catalysts today" body="No verified event was published in today’s session." />
            )}
            <p className="mt-4 text-2xs text-ink-3">{p.attributionNote}</p>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-5">
          <Panel className="p-4">
            <SectionTitle>Market regime</SectionTitle>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-medium">{p.regime.label}</span>
              <span className="num font-mono text-sm text-ink-2">
                {p.regime.volTicker ?? "VOL"} {p.regime.volIndex?.toFixed(1) ?? "—"}
              </span>
            </div>
            <p className="mt-1 text-2xs text-ink-3">{p.regime.note}</p>
          </Panel>
          <Panel className="p-4">
            <SectionTitle>Sector leadership</SectionTitle>
            <ul className="space-y-1.5">
              {p.sectors.map((s) => {
                const v = s.changePct ?? 0;
                const w = `${(Math.abs(v) / maxSector) * 50}%`;
                return (
                  <li key={s.ticker} className="grid grid-cols-[96px_minmax(0,1fr)_56px] items-center gap-2 text-xs">
                    <Link href={`/ticker/${s.ticker}`} className="truncate text-ink-2 hover:text-ink">
                      {s.sector}
                    </Link>
                    <div className="relative h-2 rounded-full bg-surface-3" aria-hidden>
                      <div className="absolute inset-y-0 left-1/2 w-px bg-ink-3" />
                      <div className={`absolute inset-y-0 rounded-full ${v >= 0 ? "left-1/2 bg-pos/70" : "right-1/2 bg-neg/70"}`} style={{ width: w }} />
                    </div>
                    <span className="num text-right font-mono">{signedPct(s.changePct, { dp: 2 })}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-2xs text-ink-3">Observed sector-fund returns. Not an additive attribution of the benchmark move.</p>
          </Panel>
          <Panel className="p-4">
            <SectionTitle>Cross-asset</SectionTitle>
            <ul className="space-y-1.5 text-xs">
              {p.crossAsset.map((c) => (
                <li key={c.ticker} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="font-mono font-semibold">{c.ticker}</span> <span className="text-ink-3">{c.label}</span>
                  </span>
                  <Pct value={c.changePct} dp={2} />
                </li>
              ))}
            </ul>
          </Panel>
          <Panel className="p-4">
            <SectionTitle>Volume anomalies</SectionTitle>
            {p.volumeAnomalies.length ? (
              <ul className="space-y-1.5 text-xs">
                {p.volumeAnomalies.map((v) => (
                  <li key={v.ticker} className="flex items-center justify-between">
                    <Link href={`/ticker/${v.ticker}`} className="font-mono font-semibold hover:text-accent">
                      {v.ticker}
                    </Link>
                    <span className="num font-mono text-warn">{v.ratio}× avg</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-3">No unusual session volume (or no volume entitlement).</p>
            )}
            <p className="mt-2 text-2xs text-ink-3">Session-to-date volume vs. 20-day average, time-of-day adjusted.</p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
