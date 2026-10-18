import Link from "next/link";
import type { Metadata } from "next";
import { getEvent, getFeed } from "@/lib/data/service";
import { subtypeLabel, stampET } from "@/lib/format";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { ImpactMap } from "@/components/graphs/ImpactMap";
import { EventPicker } from "@/components/graphs/EventPicker";

export const metadata: Metadata = { title: "Impact Map" };

export default async function ImpactMapPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const sp = await searchParams;
  const feed = await getFeed({ limit: 100 });
  const withGraph = feed.items.filter((e) => e.graph.edges.length > 0);
  const id = sp.event && /^[a-z0-9_-]{3,80}$/i.test(sp.event) ? sp.event : withGraph[0]?.id;
  const res = id ? await getEvent(id) : null;
  return (
    <div className="mx-auto max-w-[1320px]">
      <PageHeader title="Impact map" description="One verified event → macro variables and channels → sectors → exposed assets. Edge color is the sign, dashes mark hypothesized links. Hover or focus anything for its evidence, lag and confidence.">
        <EventPicker options={withGraph.map((e) => ({ id: e.id, label: `${subtypeLabel(e.subtype)} · ${stampET(e.firstPublishedAt, feed.mode.asOf)} · ${e.exposures[0]?.ticker ?? ""}` }))} value={id ?? ""} />
      </PageHeader>
      {res ? (
        <Panel className="p-4">
          <p className="mb-3 max-w-[75ch] font-serif text-md text-ink">
            <Link href={`/events/${res.event.id}`} className="hover:text-accent-strong">
              {res.event.bottomLine}
            </Link>
          </p>
          <ImpactMap graph={res.event.graph} evidenceLabels={Object.fromEntries(res.event.evidence.map((x) => [x.id, x.publisher] as const))} />
          <div className="mt-3 flex flex-wrap gap-4 text-2xs text-ink-3">
            <span><span className="mr-1 inline-block h-0.5 w-5 bg-pos align-middle" />raises</span>
            <span><span className="mr-1 inline-block h-0.5 w-5 bg-neg align-middle" />lowers</span>
            <span><span className="mr-1 inline-block h-0.5 w-5 bg-warn align-middle" />mixed / competing</span>
            <span><span className="mr-1 inline-block w-5 border-t border-dashed border-ink-2 align-middle" />hypothesized</span>
          </div>
        </Panel>
      ) : (
        <EmptyState title="No event selected" body="There is no event with a transmission graph in the current feed." />
      )}
    </div>
  );
}
