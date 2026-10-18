import Link from "next/link";
import type { Metadata } from "next";
import { getMacro } from "@/lib/data/service";
import { dateTimeET, dateET, timeET } from "@/lib/format";
import { Chip, DemoChip, EmptyState, PageHeader, Panel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Macro Radar" };
export const revalidate = 300;

const fmt = (v: number | null, unit: string) => (v === null ? "—" : unit === "%" || unit.startsWith("% ") ? `${v}%` : unit === "K" ? `${v}K` : `${v}`);

export default async function MacroPage() {
  const { mode, rows } = await getMacro();
  const released = rows.filter((r) => r.status === "released");
  const upcoming = rows.filter((r) => r.status === "upcoming").sort((a, b) => a.releaseAt.localeCompare(b.releaseAt));
  return (
    <div className="mx-auto max-w-[1320px]">
      <PageHeader
        title="Macro radar"
        description="Surprise = actual − consensus, only when the consensus is licensed and in the same unit. The prior print is never used as a consensus. A z-score needs at least 12 historical forecast errors."
      />
      {!rows.length ? (
        <EmptyState title="No macro data connected" body={mode.mode === "live" ? "Set FRED_API_KEY to load official observations and vintages. Consensus requires a separately licensed source." : "No releases in the demo world."} />
      ) : null}
      {upcoming.length ? (
        <Panel className="mb-5 p-4">
          <h2 className="mb-3 text-xs font-semibold text-ink-2">Upcoming releases</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {upcoming.map((r) => (
              <li key={r.id} className="rounded-md border border-line bg-surface-2 p-3">
                <div className="num font-mono text-2xs text-ink-3">
                  {dateET(r.releaseAt)} · {r.releaseTimeKnown ? timeET(r.releaseAt) : "time TBC"}
                </div>
                <div className="mt-0.5 text-sm font-medium">{r.indicator}</div>
                <div className="text-2xs text-ink-3">{r.period}</div>
                <div className="mt-1.5 text-xs text-ink-2">
                  Consensus <span className="num font-mono text-ink">{fmt(r.consensus, r.unit)}</span> · prior <span className="num font-mono">{fmt(r.prior, r.unit)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {released.length ? (
        <Panel className="p-4">
          <h2 className="mb-3 text-xs font-semibold text-ink-2">Released</h2>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="text-2xs text-ink-3">
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-3 font-medium">Indicator</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Released (ET)</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Actual</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Consensus</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Prior</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Revised prior</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Surprise</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">z</th>
                  <th scope="col" className="py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {released.map((r) => {
                  const s = r.surprise;
                  return (
                    <tr key={r.id} className="border-b border-line/60 align-top">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-ink">{r.eventId ? <Link href={`/events/${r.eventId}`} className="hover:text-accent">{r.indicator}</Link> : r.indicator}</div>
                        <div className="text-2xs text-ink-3">{r.period} · unit {r.unit}</div>
                      </td>
                      <td className="num whitespace-nowrap py-2 pr-3 font-mono text-ink-2">{r.releaseTimeKnown ? dateTimeET(r.releaseAt) : `${dateET(r.releaseAt)} · time not provided`}</td>
                      <td className="num py-2 pr-3 text-right font-mono text-ink">{fmt(r.actual, r.unit)}</td>
                      <td className="num py-2 pr-3 text-right font-mono text-ink-2">{r.consensus !== null ? fmt(r.consensus, r.unit) : <span className="text-ink-3">Not licensed</span>}</td>
                      <td className="num py-2 pr-3 text-right font-mono text-ink-2">{fmt(r.prior, r.unit)}</td>
                      <td className="num py-2 pr-3 text-right font-mono text-ink-2">{r.revisedPrior !== null && r.revisedPrior !== r.prior ? fmt(r.revisedPrior, r.unit) : "—"}</td>
                      <td className={`num py-2 pr-3 text-right font-mono ${s?.surprise ? (s.surprise > 0 ? "text-ink" : "text-ink") : "text-ink-3"}`}>{s?.surprise !== null && s?.surprise !== undefined ? `${s.surprise > 0 ? "+" : ""}${s.surprise}` : "—"}</td>
                      <td className="num py-2 pr-3 text-right font-mono text-ink-2">{s?.surpriseZ !== null && s?.surpriseZ !== undefined ? `${s.surpriseZ > 0 ? "+" : ""}${s.surpriseZ}` : <span className="text-ink-3" title={s?.note ?? undefined}>withheld</span>}</td>
                      <td className="py-2 text-2xs text-ink-3">
                        {r.source}
                        {r.isSynthetic ? <DemoChip className="ml-1" /> : null}
                        {s?.note ? <div className="mt-0.5 max-w-[240px] text-warn">{s.note}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-2xs text-ink-3">
            {mode.mode === "demo" ? "All values synthetic. " : "Observations via FRED (vintage-aware). "}
            <Chip>Consensus</Chip> appears only from a licensed survey source; FRED alone never provides one.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
