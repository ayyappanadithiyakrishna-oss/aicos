import type { Metadata } from "next";
import { getSecurityIndex } from "@/lib/data/service";
import { PageHeader } from "@/components/ui/primitives";
import { LocalNotice } from "@/components/personal/LocalNotice";
import { Watchlists } from "@/components/personal/Watchlists";

export const metadata: Metadata = { title: "Watchlists" };

export default async function WatchlistsPage() {
  const universe = await getSecurityIndex();
  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader title="Watchlists" description="Track tickers to focus the feed, calendar and alerts." />
      <LocalNotice what="Watchlists" />
      <Watchlists universe={universe.map((u) => ({ ticker: u.ticker, name: u.name }))} />
    </div>
  );
}
