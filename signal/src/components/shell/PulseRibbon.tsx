import Link from "next/link";
import clsx from "clsx";
import type { PulseRibbonItem } from "@/lib/data/views";
import { num, signedPct, timeET } from "@/lib/format";

export function PulseRibbon({ items, mode }: { items: PulseRibbonItem[]; mode: "demo" | "live" }) {
  return (
    <div className="border-b border-line bg-bg" aria-label="Market pulse ribbon">
      <ul className="scroll-x flex items-stretch gap-0 px-2">
        {items.map((it) => {
          const tone = it.changePct === null ? "text-ink-3" : it.changePct > 0 ? "text-pos" : it.changePct < 0 ? "text-neg" : "text-ink-2";
          return (
            <li key={it.ticker} className="shrink-0">
              <Link
                href={`/ticker/${it.ticker}`}
                className="flex h-9 items-center gap-2 rounded-md px-2.5 transition-colors hover:bg-surface-2"
                title={`${it.label} · ${it.entitlement === "synthetic" ? "synthetic price" : it.entitlement === "delayed" ? "delayed" : "no entitlement"}${it.asOf ? ` · as of ${timeET(it.asOf)}` : ""}`}
              >
                <span className="font-mono text-xs font-semibold text-ink">{it.ticker}</span>
                <span className="num font-mono text-xs text-ink-2">{it.last === null ? "—" : num(it.last)}</span>
                <span className={clsx("num font-mono text-xs", tone)}>{signedPct(it.changePct, { dp: 2 })}</span>
              </Link>
            </li>
          );
        })}
        <li className="ml-auto flex shrink-0 items-center gap-2 pl-3 pr-2 text-2xs text-ink-3">
          <span className={clsx("inline-block size-1.5 rounded-full", mode === "demo" ? "bg-warn" : items.some((i) => i.entitlement !== "none") ? "bg-accent" : "bg-ink-3")} />
          {mode === "demo" ? "Synthetic proxies" : items.some((i) => i.entitlement !== "none") ? "Delayed (end-of-day)" : "No price entitlement — values shown as —"}
        </li>
      </ul>
    </div>
  );
}
