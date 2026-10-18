import Link from "next/link";
import type { Metadata } from "next";
import { getSecurityIndex, isDemo } from "@/lib/data/service";
import { Monogram } from "@/components/ui/SecurityMark";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { TickerSearch } from "@/components/ticker/TickerSearch";

export const metadata: Metadata = { title: "Ticker Intelligence" };
export const revalidate = 300;

export default async function TickerIndex() {
  const list = await getSecurityIndex();
  const groups = [
    ["Benchmarks & proxies", list.filter((s) => s.kind !== "equity")],
    ["Equities", list.filter((s) => s.kind === "equity")],
  ] as const;
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Ticker intelligence"
        description={isDemo() ? "Every demo security is fictional. Open one to see its price path, linked events, relationship evidence and forecast track record." : "Search any symbol in the SEC company directory. Prices appear only with an entitled price provider."}
      />
      <TickerSearch />
      {groups.map(([label, xs]) =>
        xs.length ? (
          <Panel key={label} className="mt-5 p-4">
            <h2 className="mb-3 text-xs font-semibold text-ink-2">{label}</h2>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {xs.map((s) => (
                <li key={s.ticker}>
                  <Link href={`/ticker/${s.ticker}`} className="flex items-center gap-2.5 rounded-md border border-line px-2.5 py-2 hover:border-line-2 hover:bg-surface-2">
                    <Monogram ticker={s.ticker} size={24} />
                    <span className="font-mono text-sm font-semibold">{s.ticker}</span>
                    <span className="truncate text-xs text-ink-3">{s.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null,
      )}
    </div>
  );
}
