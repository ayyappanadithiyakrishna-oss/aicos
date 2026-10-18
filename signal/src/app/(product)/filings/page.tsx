import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { getEarningsAndFilings } from "@/lib/data/service";
import { dateTimeET } from "@/lib/format";
import { Chip, DemoChip, EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { Monogram } from "@/components/ui/SecurityMark";

export const metadata: Metadata = { title: "Earnings & Filings" };
export const revalidate = 120;

export default async function FilingsPage() {
  const { mode, earnings, filings } = await getEarningsAndFilings();
  return (
    <div className="mx-auto max-w-[1320px]">
      <PageHeader
        title="Earnings & filings"
        description="Expected → what changed → what matters → next confirmation. Reported-vs-consensus appears only with a licensed consensus; SEC filings are disclosures, not a consensus feed."
      />
      <Panel className="mb-5 p-4">
        <h2 className="mb-3 text-xs font-semibold text-ink-2">Earnings</h2>
        {earnings.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {earnings.map((e) => (
              <li key={e.id} className="min-w-0 rounded-md border border-line bg-surface-2 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Monogram ticker={e.ticker} size={22} />
                  <Link href={`/ticker/${e.ticker}`} className="font-mono text-sm font-semibold hover:text-accent">
                    {e.ticker}
                  </Link>
                  <span className="min-w-0 truncate text-xs text-ink-3">{e.name}</span>
                  <Chip tone={e.status === "reported" ? "accent" : "muted"} className="ml-auto">
                    {e.status}
                  </Chip>
                  {e.isSynthetic ? <DemoChip /> : null}
                </div>
                <div className="num mt-1 font-mono text-2xs text-ink-3">{dateTimeET(e.reportedAt)}</div>
                <dl className="mt-2.5 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  {[
                    ["Expected", e.expected],
                    ["What changed", e.changed],
                    ["What matters", e.matters],
                    ["Next confirmation", e.nextConfirmation],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-2xs text-ink-3">{k}</dt>
                      <dd className="text-ink-2">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-2.5 flex flex-wrap items-center gap-3 text-2xs text-ink-3">
                  <span>
                    EPS <span className="num font-mono text-ink">{e.epsActual ?? "—"}</span> vs <span className="num font-mono text-ink-2">{e.epsConsensus ?? "—"}</span>
                    {e.consensusSource ? ` (${e.consensusSource})` : ""}
                  </span>
                  <span>Guidance: {e.guidance}</span>
                  {e.eventId ? (
                    <Link href={`/events/${e.eventId}`} className="text-accent hover:underline">
                      Event dossier
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No licensed earnings data" body={mode.mode === "live" ? "Earnings actuals and consensus require a licensed provider (for example an FMP plan with display rights). Filings below still come from SEC EDGAR." : "No earnings in the demo world."} />
        )}
      </Panel>
      <Panel className="p-4">
        <h2 className="mb-3 text-xs font-semibold text-ink-2">Filings</h2>
        {filings.length ? (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-2xs text-ink-3">
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-3 font-medium">Accepted (ET)</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Company</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Form</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Items</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Accession</th>
                  <th scope="col" className="py-2 font-medium">Links</th>
                </tr>
              </thead>
              <tbody>
                {filings.map((f) => (
                  <tr key={f.id} id={f.id} className="border-b border-line/60">
                    <td className="num whitespace-nowrap py-2 pr-3 font-mono text-ink-2">{dateTimeET(f.acceptedAt)}</td>
                    <td className="py-2 pr-3">
                      {f.ticker ? (
                        <Link href={`/ticker/${f.ticker}`} className="font-mono font-semibold hover:text-accent">
                          {f.ticker}
                        </Link>
                      ) : null}{" "}
                      <span className="text-ink-2">{f.company}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-mono">{f.form}</span>
                      {f.isAmendment ? <Chip tone="warn" className="ml-1.5">Amendment</Chip> : null}
                    </td>
                    <td className="py-2 pr-3 font-mono text-ink-2">{f.items.join(", ") || "—"}</td>
                    <td className="py-2 pr-3 font-mono text-2xs text-ink-3">
                      {f.accession}
                      {f.amends ? <div>amends {f.amends}</div> : null}
                    </td>
                    <td className="py-2">
                      <a href={f.link} target={f.link.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-accent hover:underline">
                        {f.isSynthetic ? "Synthetic doc" : "EDGAR"} {f.link.startsWith("http") ? <ArrowUpRight className="size-3" /> : null}
                      </a>
                      {f.eventId ? (
                        <Link href={`/events/${f.eventId}`} className="ml-3 text-accent hover:underline">
                          Event
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No filings" body={mode.mode === "live" ? "Set SEC_USER_AGENT (name and contact email) to ingest EDGAR current filings." : "No filings in the demo world."} />
        )}
      </Panel>
    </div>
  );
}
