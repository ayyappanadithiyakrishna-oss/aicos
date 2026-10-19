import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SHARE_CLASS_ALIAS } from "@/lib/live/universe";
import type { Metadata } from "next";
import { getTicker, isDemo, getSecurityIndex } from "@/lib/data/service";
import { toCard } from "@/lib/data/cards";
import { DIRECTION_SHORT, DIRECTION_TONE, dateET, num, signedPct, stampET, subtypeLabel, timeET, TIER_SHORT } from "@/lib/format";
import { Chip, DemoChip, EmptyState, Panel, Pct, SectionTitle, Stat, toneText } from "@/components/ui/primitives";
import { Monogram } from "@/components/ui/SecurityMark";
import { TickerChart } from "@/components/charts/TickerChart";
import { ImpliedMovePanel } from "@/components/options/ImpliedMove";
import { Coverage } from "@/components/ticker/Coverage";
import { KeyStats } from "@/components/ticker/KeyStats";
import { tradingViewSymbol } from "@/lib/tradingview";
import { ScenarioSensitivity } from "@/components/ticker/ScenarioSensitivity";
import { WatchToggle } from "@/components/ticker/WatchToggle";
import { ImpactRail } from "@/components/impact/ImpactRail";

export const revalidate = 60;

export async function generateStaticParams() {
  if (!isDemo()) return [];
  return (await getSecurityIndex()).map((s) => ({ symbol: s.ticker }));
}

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  return { title: symbol.toUpperCase() };
}

export default async function TickerPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  if (!/^[A-Za-z][A-Za-z0-9.]{0,9}$/.test(symbol)) notFound();
  const primary = SHARE_CLASS_ALIAS[symbol.toUpperCase()];
  if (primary) redirect(`/ticker/${primary}`);
  const t = await getTicker(symbol);
  if (!t) notFound();
  const s = t.security;
  const q = t.quote;
  const entLabel = q.entitlement === "synthetic" ? "Synthetic price path" : q.entitlement === "delayed" ? "Delayed (end-of-day)" : q.entitlement === "realtime" ? "Real-time" : "No price entitlement";
  const hist = t.impactHistory.filter((r) => r.status === "resolved" && r.realizedAr !== null && r.central !== null);
  const hits = hist.filter((r) => r.hit).length;
  const inside = t.impactHistory.filter((r) => r.inside !== null);
  const insideN = inside.filter((r) => r.inside).length;
  const maxAbs = Math.max(1, ...t.trajectory.map((x) => Math.abs(x.central ?? 0)));

  return (
    <div className="mx-auto max-w-[1320px]">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Monogram ticker={s.ticker} size={40} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-semibold">{s.ticker}</h1>
              {s.isSynthetic ? <DemoChip /> : null}
              <Chip>{s.kind === "equity" ? "Equity" : s.kind === "etf" ? "ETF / proxy" : "Index proxy"}</Chip>
            </div>
            <p className="text-sm text-ink-2">{s.name}</p>
            <p className="text-2xs text-ink-3">
              {s.sector} · {s.industry} · {s.exchange} · security master ID <span className="font-mono">{s.id}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <Stat label={`Last · ${entLabel}`} value={q.last === null ? "—" : num(q.last)} sub={q.asOf ? `as of ${stampET(q.asOf, t.mode.asOf)}` : "no quote"} />
          <Stat label="Session change" value={<Pct value={q.changePct} dp={2} />} sub="vs. prior regular close" />
          <WatchToggle ticker={s.ticker} />
        </div>
      </header>
      {s.description ? <p className="mt-2 max-w-[75ch] text-sm text-ink-2">{s.description}</p> : null}
      <KeyStats daily={t.daily} sessionSigmaPct={t.sessionSigmaPct ?? null} articles={t.coverage ? t.coverage.length : null} sentiment={t.sentiment ?? null} />

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Panel className="p-4">
            <TickerChart tvSymbol={t.mode.mode === "live" && !s.isSynthetic ? tradingViewSymbol(s.ticker, s.exchange) : null} daily={t.daily} intraday={t.intraday} markers={t.markers} sourceLabel={`${q.source}${q.entitlement === "synthetic" ? " — synthetic, not market data" : ""}`} />
          </Panel>

          {t.coverage ? (
            <Panel className="p-4">
              <SectionTitle>Latest coverage</SectionTitle>
              <Coverage ticker={s.ticker} coverage={t.coverage} sentiment={t.sentiment ?? null} asOf={t.mode.asOf} />
            </Panel>
          ) : null}

          <Panel className="p-4">
            <SectionTitle>Recent material events</SectionTitle>
            {t.events.length ? (
              <ul className="divide-y divide-line">
                {t.events.slice(0, 8).map((e) => {
                  const c = toCard(e);
                  const mine = c.exposures.filter((x) => x.securityId === s.id);
                  return (
                    <li key={e.id} className="py-3 first:pt-0">
                      <div className="font-mono text-2xs text-ink-3">
                        {subtypeLabel(e.subtype)} · {stampET(e.firstPublishedAt, t.mode.asOf)}
                      </div>
                      <Link href={`/events/${e.id}`} className="mt-0.5 block font-serif text-md text-ink hover:text-accent-strong">
                        {e.bottomLine}
                      </Link>
                      <div className="mt-2">
                        <ImpactRail exposures={mine} horizon="next_session" max={1} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No recent events" body={`No verified event in the current feed is linked to ${s.ticker}.`} />
            )}
          </Panel>

          <Panel className="p-4">
            <SectionTitle>How the expected impact changed over time</SectionTitle>
            {t.trajectory.length ? (
              <div>
                <div className="flex h-24 items-center gap-[3px]" role="img" aria-label={`Model next-session estimates for ${s.ticker} over the last ${t.trajectory.length} events`}>
                  {t.trajectory.map((x, i) => {
                    const v = x.central ?? 0;
                    const h = Math.max(2, (Math.abs(v) / maxAbs) * 44);
                    return (
                      <div key={i} className="flex h-full flex-1 flex-col justify-center" title={`${dateET(x.at)} · ${DIRECTION_SHORT[x.direction]} · ${x.central === null ? TIER_SHORT[x.tier] : signedPct(x.central)}`}>
                        <div className="flex h-1/2 items-end">{v > 0 ? <div className="w-full rounded-t-[2px] bg-pos/70" style={{ height: h }} /> : null}</div>
                        <div className="flex h-1/2 items-start border-t border-line-2">{v < 0 ? <div className="w-full rounded-b-[2px] bg-neg/70" style={{ height: h }} /> : x.central === null ? <div className="mt-px h-1 w-full bg-line-2" /> : null}</div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-2xs text-ink-3">Each bar is one frozen next-session estimate (oldest → newest). Flat ticks are abstentions or below-noise estimates.</p>
              </div>
            ) : (
              <p className="text-sm text-ink-3">No forecast history yet.</p>
            )}
          </Panel>

          <Panel className="p-4">
            <SectionTitle>Predicted vs. actual reaction history</SectionTitle>
            <div className="mb-3 flex flex-wrap gap-6">
              <Stat label="Resolved with a point estimate" value={hist.length} />
              <Stat label="Sign hit rate" value={hist.length >= 10 ? `${Math.round((hits / hist.length) * 100)}%` : "Insufficient sample"} sub={hist.length >= 10 ? `${hits}/${hist.length}` : "needs ≥ 10"} />
              <Stat label="Inside 80% interval" value={inside.length >= 10 ? `${Math.round((insideN / inside.length) * 100)}%` : "Insufficient sample"} sub={inside.length >= 10 ? `${insideN}/${inside.length}` : "needs ≥ 10"} />
            </div>
            {t.impactHistory.length ? (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
                <table className="w-full min-w-[620px] text-xs">
                  <thead className="text-2xs text-ink-3">
                    <tr className="border-b border-line text-left">
                      <th className="py-1.5 font-medium">Issued</th>
                      <th className="py-1.5 font-medium">Event</th>
                      <th className="py-1.5 font-medium">Model</th>
                      <th className="py-1.5 font-medium">80% interval</th>
                      <th className="py-1.5 font-medium">Observed AR</th>
                      <th className="py-1.5 font-medium">Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.impactHistory.slice(0, 15).map((r) => (
                      <tr key={r.forecastId} className="border-b border-line/60">
                        <td className="num whitespace-nowrap py-1.5 font-mono text-ink-3">{dateET(r.generatedAt)}</td>
                        <td className="max-w-[260px] truncate py-1.5 text-ink-2">{r.eventTitle}</td>
                        <td className={`py-1.5 ${toneText[DIRECTION_TONE[r.direction]]}`}>{r.central === null ? TIER_SHORT[r.qualityTier] : signedPct(r.central)}</td>
                        <td className="num py-1.5 font-mono text-ink-3">{r.lo !== null ? `${signedPct(r.lo)}…${signedPct(r.hi)}` : "—"}</td>
                        <td className="num py-1.5 font-mono text-ink-2">{r.status === "resolved" ? signedPct(r.realizedAr) : r.status}</td>
                        <td className="py-1.5">{r.hit === null ? <span className="text-ink-3">—</span> : r.hit ? <Chip tone="pos">Sign hit</Chip> : <Chip tone="neg">Miss</Chip>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-ink-3">No resolved forecasts for this asset.</p>
            )}
            <p className="mt-2 text-2xs text-ink-3">{t.mode.mode === "demo" ? "Includes out-of-sample walk-forward forecasts on synthetic history" : "Frozen live forecasts, resolved separately when their outcome windows close"}; misses are kept, never dropped.</p>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-5">
          <Panel className="p-4">
            <SectionTitle>Upcoming catalysts</SectionTitle>
            {t.catalysts.length ? (
              <ul className="space-y-2 text-xs">
                {t.catalysts.map((c) => (
                  <li key={c.id}>
                    <div className="num font-mono text-2xs text-ink-3">
                      {dateET(c.at)} · {timeET(c.at)}
                      {!c.dateConfirmed ? <span className="text-warn"> · unconfirmed</span> : null}
                    </div>
                    <div className="text-ink-2">{c.title}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-3">None scheduled in the connected calendar.</p>
            )}
          </Panel>
          <Panel className="p-4">
            <SectionTitle>Attention</SectionTitle>
            <div className="flex items-baseline gap-2">
              <span className="num font-mono text-xl">{t.attention.ratio !== null ? `${t.attention.ratio}×` : "—"}</span>
              <span className="text-2xs text-ink-3">
                {t.attention.recent} event(s) this week{t.attention.baseline !== null ? ` vs ${t.attention.baseline.toFixed(1)} / week baseline` : ""}
              </span>
            </div>
            <p className="mt-1 text-2xs text-ink-3">{t.attention.note}</p>
          </Panel>
          {s.factorLoadings ? <Panel className="p-4">
            <SectionTitle>Scenario sensitivity (exploratory)</SectionTitle>
            <ScenarioSensitivity security={s} />
          </Panel> : null}
          <Panel className="p-4">
            <SectionTitle>Options-implied move</SectionTitle>
            {t.mode.mode === "live" ? <ImpliedMovePanel ticker={s.ticker} modelSessionSigmaPct={t.sessionSigmaPct ?? null} /> : <p className="text-xs text-ink-3">{t.options.reason}</p>}
          </Panel>
          {t.relationships.length ? <Panel className="p-4" aria-labelledby="relationships">
            <SectionTitle id="relationships">Documented relationships</SectionTitle>
            {t.relationships.length ? (
              <ul className="space-y-2 text-xs">
                {t.relationships.map((r, i) => (
                  <li key={i}>
                    <Link href={`/ticker/${r.ticker}`} className="font-mono font-semibold text-ink hover:text-accent">
                      {r.ticker}
                    </Link>{" "}
                    <span className="text-ink-3">
                      {r.direction === "counterparty" ? `is a ${r.kind} of ${s.ticker}` : `${s.ticker} is a ${r.kind} of ${r.ticker}`}
                    </span>
                    <div className="text-2xs text-ink-3">
                      {r.evidence} · as of {r.asOf}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-3">No documented supplier/customer/competitor data for this asset. SIGNAL does not infer relationships.</p>
            )}
          </Panel> : null}
          {t.memberships.length || t.holdings.length ? (
            <Panel className="p-4" aria-labelledby="exposures">
              <SectionTitle id="exposures">{t.holdings.length ? "Holdings" : "Index / ETF membership"}</SectionTitle>
              <ul className="space-y-1 text-xs">
                {(t.holdings.length ? t.holdings.map((h) => ({ k: h.ticker, w: h.weight })) : t.memberships.map((m) => ({ k: m.etf, w: m.weight }))).map((x) => (
                  <li key={x.k} className="flex items-center justify-between">
                    <Link href={`/ticker/${x.k}`} className="font-mono text-ink hover:text-accent">
                      {x.k}
                    </Link>
                    <span className="num font-mono text-ink-2">{(x.w * 100).toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
              {t.memberships[0] ? <p className="mt-1.5 text-2xs text-ink-3">{t.memberships[0].source}, as of {t.memberships[0].asOf}</p> : null}
            </Panel>
          ) : null}
          {t.peers.length ? (
            <Panel className="p-4">
              <SectionTitle>{s.isSynthetic ? "Peers" : "Same industry"}</SectionTitle>
              {!s.isSynthetic ? <p className="mb-2 text-xs text-ink-3">{s.industry} · largest covered companies in this industry.</p> : null}
              <div className="flex flex-wrap gap-1.5">
                {t.peers.map((p) => (
                  <Link key={p} href={`/ticker/${p}`} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 font-mono text-xs hover:border-line-2">
                    <Monogram ticker={p} size={16} /> {p}
                  </Link>
                ))}
              </div>
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
