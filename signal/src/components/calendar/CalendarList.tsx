"use client";
import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import type { CalendarItem } from "@/lib/data/views";
import { useClientState } from "@/lib/client/store";
import { Chip, DemoChip } from "@/components/ui/primitives";

const KINDS = ["all", "macro", "earnings", "policy", "corporate"] as const;

export function CalendarList({ items, asOf }: { items: CalendarItem[]; asOf: string }) {
  const [state] = useClientState();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [mine, setMine] = useState(false);
  const tz = state.settings.timeDisplay === "utc" ? "UTC" : state.settings.timeDisplay === "local" ? undefined : "America/New_York";
  const tzLabel = state.settings.timeDisplay === "utc" ? "UTC" : state.settings.timeDisplay === "local" ? "local" : "ET";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" });
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const etTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
  const filtered = items
    .filter((i) => kind === "all" || i.kind === kind)
    .filter((i) => !mine || i.tickers.some((t) => state.watchlist.includes(t)))
    .sort((a, b) => a.at.localeCompare(b.at));
  const groups = new Map<string, CalendarItem[]>();
  for (const i of filtered) {
    const k = day.format(new Date(i.at));
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={clsx("h-7 cursor-pointer rounded-md px-2.5 text-xs capitalize", kind === k ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface-2")}>
            {k}
          </button>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-ink-2">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-[var(--accent)]" /> Watchlist only
        </label>
      </div>
      {[...groups.entries()].map(([d, xs]) => (
        <section key={d} className="mb-5">
          <h2 className="mb-2 text-xs font-semibold text-ink-2">{d}</h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {xs.map((i) => {
              const past = Date.parse(i.at) < Date.parse(asOf);
              return (
                <li key={i.id} className={clsx("grid gap-1 px-4 py-3 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:items-center sm:gap-4", past && "opacity-60")}>
                  <div className="num font-mono text-xs">
                    <span className="text-ink">{time.format(new Date(i.at))} {tzLabel}</span>
                    {tzLabel !== "ET" ? <div className="text-2xs text-ink-3">{etTime.format(new Date(i.at))} ET</div> : null}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-ink">{i.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-ink-3">
                      <Chip>{i.kind}</Chip>
                      {!i.dateConfirmed ? <Chip tone="warn">Date unconfirmed</Chip> : null}
                      {i.consensusNote ? <span>{i.consensusNote}</span> : null}
                      {i.isSynthetic ? <DemoChip /> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {i.tickers.map((t) => (
                      <Link key={t} href={`/ticker/${t}`} className="rounded-sm border border-line px-1.5 font-mono text-2xs text-ink-2 hover:border-line-2 hover:text-ink">
                        {t}
                      </Link>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {!filtered.length ? <p className="text-sm text-ink-3">No catalysts match.</p> : null}
      <p className="text-2xs text-ink-3">Source: {items[0]?.source ?? "—"}</p>
    </div>
  );
}
