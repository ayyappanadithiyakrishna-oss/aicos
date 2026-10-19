import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { getEvent, getFeed, getTicker, isDemo } from "@/lib/data/service";
import { evidenceLink, toCard } from "@/lib/data/cards";
import { CONFIRMATION_LABEL, dateTimeET, signedPct, subtypeLabel } from "@/lib/format";
import { EVENT_TYPE_LABEL } from "@/lib/domain/types";
import { Chip, DemoChip, Panel, SectionTitle } from "@/components/ui/primitives";
import { ExposureTable } from "@/components/impact/ExposureTable";
import { ImpactMap } from "@/components/graphs/ImpactMap";
import { PriceChart } from "@/components/charts/PriceChart";
import { Monogram } from "@/components/ui/SecurityMark";

export const revalidate = 60;

export async function generateStaticParams() {
  if (!isDemo()) return [];
  const feed = await getFeed({ limit: 100 });
  return feed.items.map((e) => ({ id: e.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const res = await getEvent((await params).id);
  return res ? { title: subtypeLabel(res.event.subtype), description: res.event.bottomLine } : { title: "Event not found" };
}

const QUALITY_LABEL: Record<string, string> = {
  sourceReliability: "Source reliability",
  verifiedFacts: "Verified facts",
  timeliness: "Timeliness",
  providerFreshness: "Provider freshness",
  quantifiedEvidence: "Quantified evidence",
  distinctiveness: "Distinctiveness",
};

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getEvent(id);
  if (!res) notFound();
  const { event: e, related, mode } = res;
  const card = toCard(e);
  const primary = e.exposures[0];
  const ticker = primary ? await getTicker(primary.ticker) : null;
  const evLabels = Object.fromEntries(e.evidence.map((x) => [x.id, x.publisher] as const));
  const resolved = e.realizations.filter((r) => r.status !== "pending");
  const fById = new Map(e.forecasts.map((f) => [f.id, f] as const));

  return (
    <article className="mx-auto max-w-[1280px]">
      <nav aria-label="Breadcrumb" className="mb-3 text-2xs text-ink-3">
        <Link href="/" className="hover:text-ink">
          Intelligence feed
        </Link>{" "}
        / Event dossier
      </nav>

      <header className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-ink-3">
          <span className="font-semibold text-ink-2">{subtypeLabel(e.subtype)}</span>· {EVENT_TYPE_LABEL[e.eventType]} · {e.primarySourceName}
          <Chip tone={e.confirmationStatus === "unverified" ? "warn" : "accent"}>
            {CONFIRMATION_LABEL[e.confirmationStatus]}
          </Chip>
          {e.overlapping ? <Chip tone="warn">Overlapping event</Chip> : null}
          {e.isSynthetic ? <DemoChip /> : null}
        </div>
        <h1 className="mt-2 max-w-[70ch] font-serif text-xl font-medium leading-[1.4] text-ink sm:text-2xl">{e.bottomLine}</h1>
        <p className="mt-2 max-w-[75ch] text-sm text-ink-2">{e.whyItMatters}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-2xs sm:grid-cols-4">
          <div>
            <dt className="text-ink-3">First published</dt>
            <dd className="num font-mono text-ink-2">{dateTimeET(e.firstPublishedAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Ingested</dt>
            <dd className="num font-mono text-ink-2">{dateTimeET(e.ingestedAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Last updated</dt>
            <dd className="num font-mono text-ink-2">{dateTimeET(e.updatedAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Forecast as-of</dt>
            <dd className="num font-mono text-ink-2">{dateTimeET(e.asOf)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-2xs text-ink-3">
          Original headline: <span className="text-ink-2">{e.originalTitle}</span>
        </p>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Panel className="p-4">
            <SectionTitle>What changed — verified facts</SectionTitle>
            {e.verifiedFacts.length ? (
              <ul className="space-y-2">
                {card.facts.map((f, i) => (
                  <li key={i} className="text-sm text-ink">
                    {f.text}
                    <div className="mt-0.5 font-mono text-[11px] text-ink-3">
                      Confirmed fact
                      {f.evidence ? (
                        <>
                          {" · "}
                          <a href={f.evidence.href} target={f.evidence.external ? "_blank" : undefined} rel={f.evidence.external ? "noopener noreferrer nofollow" : undefined} className="text-accent hover:underline">
                            {f.evidence.label}
                          </a>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">No fact survived evidence checks.</p>
            )}
            {e.macro ? (
              <div className="mt-3 rounded-md border border-line bg-surface-2 p-3 text-xs">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {[
                    ["Actual", `${e.macro.actual}${e.macro.unit === "%" ? "%" : ` ${e.macro.unit}`}`],
                    ["Consensus", e.macro.consensus !== null ? `${e.macro.consensus}${e.macro.unit === "%" ? "%" : ` ${e.macro.unit}`}` : "Not licensed"],
                    ["Prior / revised", `${e.macro.prior ?? "—"} / ${e.macro.revisedPrior ?? "—"}`],
                    ["Surprise", e.macro.surprise !== null ? `${e.macro.surprise > 0 ? "+" : ""}${e.macro.surprise}` : "Not computed"],
                    ["Surprise z", e.macro.surpriseZ !== null ? `${e.macro.surpriseZ}` : "Withheld"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="text-2xs text-ink-3">{k}</div>
                      <div className="num font-mono text-ink">{v}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-2xs text-ink-3">{e.macro.note ?? `Consensus: ${e.macro.consensusSource}. Surprise = actual − consensus in matching units; z uses ${e.macro.historyN} historical forecast errors.`}</p>
              </div>
            ) : null}
          </Panel>

          <Panel className="p-4">
            <SectionTitle>Transmission mechanism</SectionTitle>
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink-2">
              {e.transmission.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  {i > 0 ? <span className="text-accent">→</span> : null}
                  {t}
                </span>
              ))}
            </p>
            <div className="mt-3">
              <ImpactMap graph={e.graph} evidenceLabels={evLabels} />
            </div>
          </Panel>

          <Panel className="p-4">
            <SectionTitle>Impacted assets · model-estimated abnormal reaction</SectionTitle>
            <ExposureTable exposures={card.exposures} />
            <p className="mt-2 text-2xs text-ink-3">
              Abnormal return = raw log return − β × benchmark return (past-only β). Estimates are conditional model views frozen at {dateTimeET(e.asOf)}; options-implied ranges are a different quantity and are not shown without an entitled options feed.
            </p>
          </Panel>

          {primary && ticker ? (
            <Panel className="p-4">
              <SectionTitle>
                Price around the event · <span className="font-mono">{primary.ticker}</span>
              </SectionTitle>
              <PriceChart daily={ticker.daily} intraday={ticker.intraday} markers={[{ at: e.firstPublishedAt, label: "Event", severity: "high" }]} sourceLabel={`${ticker.quote.source}${mode.mode === "demo" ? " (synthetic)" : ""}`} height={240} />
            </Panel>
          ) : null}

          <Panel className="p-4">
            <SectionTitle>Priced in?</SectionTitle>
            {e.pricedIn.length ? (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
                <table className="w-full min-w-[460px] text-xs">
                  <thead className="text-2xs text-ink-3">
                    <tr className="border-b border-line text-left">
                      <th className="py-1.5 font-medium">Asset</th>
                      <th className="py-1.5 font-medium">Pre-event drift (5 sess.)</th>
                      <th className="py-1.5 font-medium">Observed since publication</th>
                      <th className="py-1.5 font-medium">Modeled remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.pricedIn.map((p) => (
                      <tr key={p.securityId} className="border-b border-line/60">
                        <td className="py-1.5 font-mono font-semibold">{p.ticker}</td>
                        <td className="num py-1.5 font-mono text-ink-2">{signedPct(p.preEventDriftPct)}</td>
                        <td className="num py-1.5 font-mono text-ink-2">{signedPct(p.realizedSincePct)}</td>
                        <td className="py-1.5 text-ink-3">{p.remainingPct === null ? "Not estimable" : signedPct(p.remainingPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="mt-2 text-2xs text-ink-3">Three separate quantities — never blended into an invented “% priced in”. Remaining move requires a model conditioned on prices at analysis time.</p>
          </Panel>

          <Panel className="p-4">
            <SectionTitle>Forecast checks</SectionTitle>
            {resolved.length ? (
              <ul className="space-y-1.5 text-xs">
                {resolved.map((r) => {
                  const f = fById.get(r.forecastId);
                  if (!f) return null;
                  const inside = r.abnormalReturnPct !== null && f.intervalLowPct !== null ? r.abnormalReturnPct >= f.intervalLowPct && r.abnormalReturnPct <= f.intervalHighPct! : null;
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className="font-mono font-semibold">{f.ticker}</span>
                      <span className="text-ink-3">{f.horizon.replace("_", " ")}</span>
                      <span className="text-ink-2">
                        Model {f.centralMovePct === null ? (f.qualityTier === "insufficient" ? "abstained" : "no point estimate") : signedPct(f.centralMovePct)}
                      </span>
                      <span className="text-ink-2">Observed {r.status === "resolved" ? signedPct(r.abnormalReturnPct) : r.status.replace("_", " ")}</span>
                      {inside !== null ? <Chip tone={inside ? "pos" : "warn"}>{inside ? "Inside 80% interval" : "Outside interval"}</Chip> : null}
                      {r.quality && r.quality !== "clean" ? <span className="text-2xs text-warn">{r.quality.replace(/_/g, " ")}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">No horizon has matured yet; realizations will be recorded separately without modifying the frozen forecasts.</p>
            )}
          </Panel>

          <Panel className="p-4" aria-labelledby="contradictions">
            <SectionTitle id="contradictions">Contradictions & what would falsify the view</SectionTitle>
            <ul className="space-y-2.5">
              {e.contradictions.map((c) => (
                <li key={c.id} className="text-sm">
                  <Chip tone={c.kind === "counter_mechanism" ? "muted" : "warn"}>{c.kind.replace(/_/g, " ")}</Chip>
                  <p className="mt-1 text-ink-2">{c.text}</p>
                  <p className="text-2xs text-ink-3">Falsifier: {c.falsifier}</p>
                </li>
              ))}
            </ul>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-2xs font-medium text-ink-3">Scenario — upside</div>
                <p className="mt-0.5 text-sm text-ink-2">{e.scenario.upside}</p>
              </div>
              <div>
                <div className="text-2xs font-medium text-ink-3">Scenario — downside</div>
                <p className="mt-0.5 text-sm text-ink-2">{e.scenario.downside}</p>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-2xs font-medium text-ink-3">Open questions</div>
              <ul className="mt-1 space-y-0.5 text-sm text-ink-2">
                {e.openQuestions.map((q) => (
                  <li key={q}>· {q}</li>
                ))}
              </ul>
            </div>
          </Panel>

          <Panel className="p-4">
            <SectionTitle>Historical analogs</SectionTitle>
            <p className="text-2xs text-ink-3">{e.analogNote}</p>
            {e.analogs.length ? (
              <ul className="mt-2 divide-y divide-line text-xs">
                {e.analogs.map((a) => (
                  <li key={a.eventId} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate text-ink-2">{a.title}</span>
                    <span className="num shrink-0 font-mono text-ink-3">{new Date(a.at).toISOString().slice(0, 10)}</span>
                    <span className="num w-16 shrink-0 text-right font-mono">{signedPct(a.abnormalReturnPct)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
        </div>

        <aside className="min-w-0 space-y-5">
          <Panel className="p-4">
            <SectionTitle>Timeline</SectionTitle>
            <ol className="relative space-y-3 border-l border-line-2 pl-4">
              {e.timeline.map((t, i) => (
                <li key={i} className="relative text-xs">
                  <span className="absolute -left-[21px] top-1 size-2 rounded-full border border-line-2 bg-surface-3" aria-hidden />
                  <div className="num font-mono text-2xs text-ink-3">
                    {dateTimeET(t.at)} · {t.kind.replace("_", " ")}
                  </div>
                  <div className="text-ink-2">{t.text}</div>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel className="p-4">
            <SectionTitle>Who said what</SectionTitle>
            <ul className="space-y-2.5">
              {e.evidence
                .filter((x) => x.kind !== "data")
                .map((x) => {
                  const l = evidenceLink(x);
                  return (
                    <li key={x.id} className="text-xs">
                      <div className="flex items-center gap-1.5">
                        <a href={l.href} target={l.external ? "_blank" : undefined} rel={l.external ? "noopener noreferrer nofollow" : undefined} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                          {x.publisher} {l.external ? <ArrowUpRight className="size-3" aria-hidden /> : null}
                        </a>
                        <Chip tone={x.isOriginal ? "accent" : "muted"}>{x.isOriginal ? "Original" : "Echo"}</Chip>
                      </div>
                      <div className="num font-mono text-2xs text-ink-3">{dateTimeET(x.publishedAt)} · {x.kind}</div>
                      <p className="mt-0.5 text-ink-2">{x.excerpt}</p>
                    </li>
                  );
                })}
            </ul>
            <p className="mt-3 text-2xs text-ink-3">
              Echo index: {e.novelty.originalCount} original disclosure(s), {e.novelty.echoCount} derivative report(s) across {e.novelty.distinctPublishers} publisher(s). Echoes are not confirmations.
            </p>
          </Panel>

          <Panel className="p-4">
            <SectionTitle>Event quality · {e.quality.score}/100</SectionTitle>
            <ul className="space-y-1.5">
              {Object.entries(e.quality.components).map(([k, v]) => (
                <li key={k} className="text-2xs">
                  <div className="flex justify-between text-ink-3">
                    <span>{QUALITY_LABEL[k] ?? k}</span>
                    <span className="num font-mono text-ink-2">{Math.round(v * 100)}</span>
                  </div>
                  <div className="mt-0.5 h-1 rounded-full bg-surface-3">
                    <div className="h-1 rounded-full bg-accent/70" style={{ width: `${Math.round(v * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-2xs text-ink-3">A transparent composite of evidence properties — not a language-model confidence.</p>
          </Panel>

          {e.limitations.length || e.quarantined.length ? (
            <Panel className="p-4">
              <SectionTitle>Limitations & quarantine</SectionTitle>
              <ul className="space-y-1 text-xs text-ink-2">
                {e.limitations.map((l) => (
                  <li key={l}>· {l}</li>
                ))}
              </ul>
              {e.quarantined.length ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {e.quarantined.map((q) => (
                    <li key={q.symbol} className="text-warn">
                      <span className="font-mono">{q.symbol}</span> quarantined — {q.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          ) : null}

          {related.length ? (
            <Panel className="p-4">
              <SectionTitle>Related events</SectionTitle>
              <ul className="space-y-2">
                {related.map((r) => (
                  <li key={r.id}>
                    <Link href={`/events/${r.id}`} className="group flex gap-2">
                      <Monogram ticker={r.exposures[0]?.ticker ?? "·"} size={18} />
                      <span className="line-clamp-2 text-xs text-ink-2 group-hover:text-ink">{r.bottomLine}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </aside>
      </div>
    </article>
  );
}
