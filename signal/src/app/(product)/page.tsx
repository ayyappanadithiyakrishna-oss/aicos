import { Suspense } from "react";
import { FeedView } from "@/components/feed/FeedView";
import { RightRail } from "@/components/feed/RightRail";
import { toCard } from "@/lib/data/cards";
import { getCalendar, getFeed, getPulse } from "@/lib/data/service";
import { FeedSkeleton } from "@/components/feed/FeedSkeleton";

export const revalidate = 60;

export default async function FeedPage() {
  const [feed, pulse, catalysts, all] = await Promise.all([getFeed({ limit: 30 }), getPulse(), getCalendar(), getFeed({ limit: 100 })]);
  const initial = { items: feed.items.map(toCard), total: feed.total, nextCursor: feed.nextCursor, categories: feed.categories };
  return (
    <div className="grid gap-5 min-[1380px]:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-[-0.01em]">Intelligence feed</h1>
          <p className="text-2xs text-ink-3">
            Insight first, article second. Every number is either a sourced fact or a model estimate labelled with its horizon and uncertainty.
          </p>
        </div>
        {feed.mode.mode === "live" && !feed.items.length ? (
          <div className="mb-4 rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">
            <p className="font-medium text-ink">No live events yet.</p>
            <p className="mt-1">{feed.freshness.note} Configure providers on the Data Status page; live mode never substitutes demo data.</p>
          </div>
        ) : null}
        <Suspense fallback={<FeedSkeleton />}>
          <FeedView initial={initial} asOf={feed.mode.asOf} />
        </Suspense>
      </div>
      <div className="hidden min-[1380px]:block">
        <div className="sticky top-[calc(var(--chrome-h)+1rem)]">
          <RightRail pulse={pulse} catalysts={catalysts} events={all.items} freshness={feed.freshness} asOf={feed.mode.asOf} />
        </div>
      </div>
    </div>
  );
}
