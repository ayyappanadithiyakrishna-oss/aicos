import Link from "next/link";

export function DemoBanner({ asOf }: { asOf: string }) {
  const when = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(asOf));
  return (
    <div role="note" aria-label="Demo mode" className="bg-warn-dim">
      <div className="flex h-7 items-center gap-x-3 overflow-hidden whitespace-nowrap px-4 text-xs">
        <span className="shrink-0 font-semibold text-warn">Demo · synthetic data</span>
        <span className="truncate text-ink-2">
          <span className="sm:hidden">No live market data.</span>
          <span className="hidden sm:inline">Fictional companies, tickers, releases and prices. No live market data. Demo clock frozen at {when} ET.</span>
        </span>
        <Link href="/status" className="ml-auto shrink-0 text-accent underline-offset-2 hover:underline sm:ml-0">
          Why demo?
        </Link>
      </div>
    </div>
  );
}
