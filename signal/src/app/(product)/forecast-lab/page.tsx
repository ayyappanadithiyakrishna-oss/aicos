import Link from "next/link";
import type { Metadata } from "next";
import { getArchive } from "@/lib/data/service";
import { DIRECTION_SHORT, DIRECTION_TONE, HORIZON_SHORT, REASON_SHORT, TIER_SHORT, dateTimeET, pct, signedPct } from "@/lib/format";
import { Chip, PageHeader, Panel, toneText } from "@/components/ui/primitives";
import { ArchiveFilters } from "@/components/lab/ArchiveFilters";

export const metadata: Metadata = { title: "Forecast Lab" };

type SP = { ticker?: string; horizon?: string; sample?: string; status?: string; cursor?: string };

export default async function ForecastLab({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const clean = {
    ticker: sp.ticker && /^[A-Za-z.]{1,10}$/.test(sp.ticker) ? sp.ticker.toUpperCase() : undefined,
    horizon: ["1h", "next_session", "5_sessions"].includes(sp.horizon ?? "") ? sp.horizon : undefined,
    sample: ["current", "oos"].includes(sp.sample ?? "") ? sp.sample : undefined,
    status: ["pending", "resolved", "failed", "not_resolvable"].includes(sp.status ?? "") ? sp.status : undefined,
    cursor: sp.cursor,
    limit: 50,
  };
  const a = await getArchive(clean);
  const next = a.nextCursor ? `?${new URLSearchParams({ ...Object.fromEntries(Object.entries(clean).filter(([k, v]) => v && k !== "limit" && k !== "cursor")), cursor: a.nextCursor } as Record<string, string>)}` : null;
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Forecast lab"
        description="The full archive of forecasts exactly as issued. Snapshots are immutable; a revision is a new record that links to the one it supersedes. Realized outcomes are stored separately, and misses are never removed."
      />
      <ArchiveFilters />
      <Panel className="mt-4 p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-2xs text-ink-3">
          <span>{a.total.toLocaleString()} forecasts match</span>
          {Object.entries(a.counts).map(([k, v]) => (
            <span key={k}>
              {k === "live_demo" ? "current events" : k === "oos" ? "walk-forward out-of-sample" : k === "in_sample" ? "in-sample (excluded here)" : k}: <span className="num font-mono text-ink-2">{v.toLocaleString()}</span>
            </span>
          ))}
        </div>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[1080px] text-left text-xs">
            <thead className="text-2xs text-ink-3">
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-2 font-medium">Issued (ET)</th>
                <th scope="col" className="py-2 pr-3 font-medium">Asset · horizon</th>
                <th scope="col" className="py-2 pr-3 font-medium">Event</th>
                <th scope="col" className="py-2 pr-3 font-medium">Direction</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Central</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">80% interval</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">P(↑/↓/·)</th>
                <th scope="col" className="py-2 pr-3 font-medium">Quality</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Observed AR</th>
                <th scope="col" className="py-2 pr-4 font-medium">Version · revision</th>
              </tr>
            </thead>
            <tbody>
              {a.rows.map(({ forecast: f, realization: r, eventTitle, eventId, sample, superseded }) => (
                <tr key={f.id} className={`border-b border-line/60 align-top ${superseded ? "opacity-60" : ""}`}>
                  <td className="num whitespace-nowrap px-4 py-2 font-mono text-ink-2">
                    {dateTimeET(f.forecastGeneratedAt)}
                    <div className="text-2xs text-ink-3">as-of {dateTimeET(f.asOf)}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <Link href={`/ticker/${f.ticker}`} className="font-mono font-semibold hover:text-accent">
                      {f.ticker}
                    </Link>{" "}
                    <span className="text-ink-3">{HORIZON_SHORT[f.horizon]}</span>
                    <div className="text-2xs text-ink-3">{sample === "current" ? "current event" : "walk-forward OOS"}</div>
                  </td>
                  <td className="max-w-[240px] py-2 pr-3">
                    {sample === "current" ? (
                      <Link href={`/events/${eventId}`} className="line-clamp-2 text-ink-2 hover:text-ink">
                        {eventTitle}
                      </Link>
                    ) : (
                      <span className="line-clamp-2 text-ink-3">{eventTitle}</span>
                    )}
                  </td>
                  <td className={`py-2 pr-3 ${toneText[DIRECTION_TONE[f.direction]]}`}>{DIRECTION_SHORT[f.direction]}</td>
                  <td className="num py-2 pr-3 text-right font-mono">{signedPct(f.centralMovePct)}</td>
                  <td className="num py-2 pr-3 text-right font-mono text-ink-2">{f.intervalLowPct !== null ? `${signedPct(f.intervalLowPct)} … ${signedPct(f.intervalHighPct)}` : "—"}</td>
                  <td className="num py-2 pr-3 text-right font-mono text-ink-2">{f.probabilities ? `${pct(f.probabilities.up)}/${pct(f.probabilities.down)}/${pct(f.probabilities.neutral)}` : "withheld"}</td>
                  <td className="py-2 pr-3">
                    <div className="text-ink-2">{TIER_SHORT[f.qualityTier]}</div>
                    <div className="text-2xs text-ink-3">{f.reasonCodes.filter((c) => c !== "CALIBRATED").map((c) => REASON_SHORT[c] ?? c).join(" · ")}</div>
                  </td>
                  <td className="num py-2 pr-3 text-right font-mono">
                    {r?.status === "resolved" ? signedPct(r.abnormalReturnPct) : <span className="text-ink-3">{r?.status?.replace("_", " ") ?? "pending"}</span>}
                    {r?.quality && r.quality !== "clean" ? <div className="text-2xs text-warn">{r.quality.replace(/_/g, " ")}</div> : null}
                  </td>
                  <td className="py-2 pr-4 font-mono text-2xs text-ink-3">
                    {f.modelVersion} · r{f.revision}
                    {f.supersedes ? <div className="text-accent">supersedes {f.supersedes.slice(0, 11)}…</div> : null}
                    {superseded ? <Chip tone="warn" className="mt-0.5">Superseded</Chip> : null}
                    <div className="mt-0.5 break-all">{f.id}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {next ? (
          <div className="flex justify-center border-t border-line p-3">
            <Link href={`/forecast-lab${next}`} className="text-xs text-accent hover:underline">
              Older forecasts →
            </Link>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
