import Link from "next/link";
import type { IntelligenceEvent } from "@/lib/domain/types";
import type { FeedFreshness, ModeInfo } from "@/lib/data/views";
import { relative } from "@/lib/format";
import { Monogram } from "@/components/ui/SecurityMark";

/** A short, source-backed orientation before the feed. No generated market narrative. */
export function Briefing({ events, mode, freshness }: { events: IntelligenceEvent[]; mode: ModeInfo; freshness: FeedFreshness }) {
  const catalysts = events.filter((e) => e.subtype !== "other.unclassified");
  const publishers = new Set(events.flatMap((e) => e.evidence.filter((v) => v.kind !== "data").map((v) => v.publisher)));
  const counts = new Map<string, { n: number; name: string }>();
  for (const e of events) for (const x of e.exposures) {
    if (x.directness !== "direct") continue;
    const prev = counts.get(x.ticker);
    counts.set(x.ticker, { n: (prev?.n ?? 0) + 1, name: x.name });
  }
  const active = [...counts].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, 6);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" }).format(new Date(mode.asOf));
  return (
    <section aria-label="Market briefing" className="mb-5 border-b border-line pb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="mb-1 text-xs text-ink-3">{date} · {mode.clock.state === "regular" ? "Market open" : "Outside regular hours"}</p>
          <h1 className="display text-ink">Market briefing</h1>
        </div>
        <Link href="/status" className="flex items-center gap-1.5 text-xs text-ink-2 hover:text-accent">
          <span aria-hidden className={`size-1.5 rounded-full ${freshness.stale ? "bg-warn" : "bg-pos"}`} />
          {freshness.lastIngestAt ? `Feed updated ${relative(freshness.lastIngestAt, mode.asOf)}` : mode.mode === "demo" ? "Synthetic demo" : "Awaiting refresh"}
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
        <Link href="/?category=catalysts" className="hover:text-accent"><strong className="num font-semibold text-ink">{catalysts.length}</strong> classified catalysts</Link>
        <Link href="/?category=coverage" className="hover:text-accent"><strong className="num font-semibold text-ink">{events.length - catalysts.length}</strong> company stories</Link>
        <span>{publishers.size} publishers in this briefing</span>
      </div>
      {active.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-ink-3">Most covered</span>
          {active.map(([t, c]) => (
            <Link key={t} href={`/ticker/${t}`} title={`${c.name} · ${c.n} stories`} className="press inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-2 text-xs text-ink hover:border-line-2 hover:bg-surface-2">
              <Monogram ticker={t} size={18} /><span className="font-semibold">{t}</span><span className="num text-ink-3">{c.n}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
