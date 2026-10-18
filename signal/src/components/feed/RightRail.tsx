import Link from "next/link";
import type { IntelligenceEvent } from "@/lib/domain/types";
import type { CalendarItem, FeedFreshness, MarketPulseView } from "@/lib/data/views";
import { relative, stampET, subtypeLabel, timeET } from "@/lib/format";
import { Pct } from "@/components/ui/primitives";

function RailSection({ title, children, href }: { title: string; children: React.ReactNode; href?: string }) {
  return (
    <section className="border-b border-line px-4 py-3.5 last:border-b-0">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-ink-2">{title}</h2>
        {href ? (
          <Link href={href} className="text-2xs text-accent hover:underline">
            Open
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function RightRail({ pulse, catalysts, events, freshness, asOf }: { pulse: MarketPulseView; catalysts: CalendarItem[]; events: IntelligenceEvent[]; freshness: FeedFreshness; asOf: string }) {
  const upcoming = catalysts.filter((c) => Date.parse(c.at) >= Date.parse(asOf)).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 4);
  const conviction = [...events].sort((a, b) => b.quality.score - a.quality.score).slice(0, 3);
  const disputed = events
    .map((e) => ({ e, n: e.contradictions.filter((c) => c.kind !== "counter_mechanism").length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  return (
    <aside aria-label="Intelligence rail" className="rounded-lg border border-line bg-surface">
      <RailSection title="Market regime" href="/pulse">
        <div className="flex items-baseline justify-between">
          <span className="text-md font-medium text-ink">{pulse.regime.label}</span>
          <span className="num font-mono text-xs text-ink-2">
            {pulse.regime.volTicker ?? "VOL"} {pulse.regime.volIndex?.toFixed(1) ?? "—"}
          </span>
        </div>
        <p className="mt-1 text-2xs text-ink-3">{pulse.regime.note}</p>
      </RailSection>
      <RailSection title="Cross-asset transmission">
        <ul className="space-y-1.5">
          {pulse.crossAsset.map((c) => (
            <li key={c.ticker} className="flex items-center justify-between gap-2 text-xs">
              <Link href={`/ticker/${c.ticker}`} className="min-w-0 truncate text-ink-2 hover:text-ink">
                <span className="font-mono font-semibold text-ink">{c.ticker}</span> <span className="text-ink-3">{c.label}</span>
              </Link>
              <Pct value={c.changePct} dp={2} className="text-xs" />
            </li>
          ))}
        </ul>
        <p className="mt-2 text-2xs text-ink-3">Observed session changes. Links to events are hypotheses.</p>
      </RailSection>
      <RailSection title="Catalysts ahead" href="/calendar">
        {upcoming.length ? (
          <ul className="space-y-2">
            {upcoming.map((c) => (
              <li key={c.id} className="text-xs">
                <div className="flex items-center gap-1.5 text-2xs text-ink-3">
                  <span className="num font-mono">{stampET(c.at, asOf)}</span>
                  {!c.dateConfirmed ? <span className="text-warn">· date unconfirmed</span> : null}
                </div>
                <div className="text-ink-2">{c.title}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-2xs text-ink-3">No licensed catalyst calendar connected.</p>
        )}
      </RailSection>
      <RailSection title="Highest-quality evidence">
        <ul className="space-y-2">
          {conviction.map((e) => (
            <li key={e.id}>
              <Link href={`/events/${e.id}`} className="group block">
                <div className="flex items-center gap-1.5 text-2xs text-ink-3">
                  <span className="num font-mono text-ink-2">Q{e.quality.score}</span> · {subtypeLabel(e.subtype)}
                </div>
                <div className="line-clamp-2 text-xs text-ink-2 group-hover:text-ink">{e.bottomLine}</div>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-2xs text-ink-3">Ranked by evidence quality, not by predicted magnitude.</p>
      </RailSection>
      <RailSection title="Most disputed interpretations">
        {disputed.length ? (
          <ul className="space-y-2">
            {disputed.map(({ e, n }) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}#contradictions`} className="group block">
                  <div className="text-2xs text-warn">
                    {n} conflict{n === 1 ? "" : "s"} · {subtypeLabel(e.subtype)}
                  </div>
                  <div className="line-clamp-2 text-xs text-ink-2 group-hover:text-ink">{e.contradictions.find((c) => c.kind !== "counter_mechanism")?.text}</div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-2xs text-ink-3">No source, model or market conflicts right now.</p>
        )}
      </RailSection>
      <RailSection title="Feed freshness" href="/status">
        <dl className="grid grid-cols-2 gap-y-1 text-2xs">
          <dt className="text-ink-3">Newest item</dt>
          <dd className="num text-right font-mono text-ink-2">{freshness.newestItemAt ? relative(freshness.newestItemAt, asOf) : "—"}</dd>
          <dt className="text-ink-3">Last ingest</dt>
          <dd className="num text-right font-mono text-ink-2">{freshness.lastIngestAt ? timeET(freshness.lastIngestAt) : "—"}</dd>
          <dt className="text-ink-3">Ingest lag p50 / p95</dt>
          <dd className="num text-right font-mono text-ink-2">
            {freshness.ingestLagP50Min !== null ? `${freshness.ingestLagP50Min}m / ${freshness.ingestLagP95Min}m` : "—"}
          </dd>
        </dl>
        <p className="mt-1.5 text-2xs text-ink-3">{freshness.note}</p>
      </RailSection>
    </aside>
  );
}
