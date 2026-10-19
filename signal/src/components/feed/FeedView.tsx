"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import clsx from "clsx";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { CardModel } from "@/lib/data/cards";
import type { Horizon } from "@/lib/domain/types";
import { useClientState } from "@/lib/client/store";
import { buttonClass, EmptyState } from "@/components/ui/primitives";
import { EventCard } from "./EventCard";

interface Props {
  initial: { items: CardModel[]; total: number; nextCursor: string | null; categories: Array<{ key: string; label: string; count: number }> };
  asOf: string;
}

const FILTER_KEYS = ["category", "severity", "direction", "horizon", "minQuality", "recency", "verifiedOnly", "q", "sort"] as const;

function paramsToQuery(sp: URLSearchParams, watchlist: string[]): string {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = sp.get(k);
    if (v) p.set(k, v);
  }
  if (sp.get("category") === "watchlist") p.set("tickers", watchlist.join(","));
  p.set("format", "card");
  p.set("limit", "30");
  return p.toString();
}

export function FeedView({ initial, asOf }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [state] = useClientState();
  const [result, setResult] = useState<{ key: string; data: Props["initial"] }>({ key: "initial", data: initial });
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [focus, setFocus] = useState(-1);
  const [qInput, setQInput] = useState(sp.get("q") ?? "");
  const listRef = useRef<HTMLDivElement>(null);
  const isDefault = FILTER_KEYS.every((k) => !sp.get(k));
  const category = sp.get("category") ?? "all";
  const horizon = (sp.get("horizon") as Horizon | null) ?? state.settings.defaultHorizon;
  const watchKey = state.watchlist.join(",");

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const p = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "" || (k === "category" && v === "all")) p.delete(k);
        else p.set(k, v);
      }
      const s = p.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );

  const useInitial = isDefault && state.settings.ranking === "market";
  const queryKey = useInitial ? "initial" : `${sp.toString()}|${watchKey}|${state.settings.ranking}`;
  // Stale-while-loading: keep showing the last result until the new query resolves.
  const data = useInitial ? (result.key === "initial" ? result.data : initial) : result.data;
  const loading = loadingMore || (!useInitial && result.key !== queryKey);

  useEffect(() => {
    if (useInitial) return;
    const ctrl = new AbortController();
    const query = paramsToQuery(new URLSearchParams(sp.toString()), state.watchlist);
    fetch(`/api/feed?${query}${state.settings.ranking === "watchlist" && state.watchlist.length ? `&prioritize=watchlist&watch=${encodeURIComponent(watchKey)}` : ""}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Feed request failed (${r.status})`);
        setResult({ key: queryKey, data: (await r.json()) as Props["initial"] });
        setError(null);
        setFocus(-1);
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") {
          setError((e as Error).message);
          setResult((prev) => ({ ...prev, key: queryKey }));
        }
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey captures every input that changes the request
  }, [queryKey]);

  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") !== qInput) setParam({ q: qInput || null });
    }, 300);
    return () => clearTimeout(t);
  }, [qInput, sp, setParam]);

  const loadMore = async () => {
    if (!data.nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/feed?${paramsToQuery(new URLSearchParams(sp.toString()), state.watchlist)}&cursor=${encodeURIComponent(data.nextCursor)}`);
      if (!r.ok) throw new Error(`Feed request failed (${r.status})`);
      const next = (await r.json()) as Props["initial"];
      setResult({ key: queryKey, data: { ...next, items: [...data.items, ...next.items] } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  // j/k/o/b keyboard navigation across cards.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const cards = listRef.current?.querySelectorAll<HTMLElement>("[data-card-id]");
      if (!cards?.length) return;
      if (e.key === "j" || e.key === "k") {
        const next = Math.max(0, Math.min(cards.length - 1, focus + (e.key === "j" ? 1 : -1)));
        setFocus(next);
        cards[next]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        cards[next]?.focus({ preventScroll: true });
      } else if (e.key === "o" || e.key === "Enter") {
        cards[focus]?.querySelector<HTMLButtonElement>("[data-action=expand]")?.click();
      } else if (e.key === "b") {
        cards[focus]?.querySelector<HTMLButtonElement>("[data-action=bookmark]")?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  const activeFilters = useMemo(() => FILTER_KEYS.filter((k) => k !== "category" && k !== "q" && k !== "horizon" && sp.get(k)), [sp]);
  const cats = [...data.categories, { key: "watchlist", label: "Your watchlist", count: state.watchlist.length }];

  return (
    <div>
      <div className="sticky top-[var(--chrome-h)] -mx-4 mb-3 border-b border-line bg-bg/95 px-4 pb-2.5 pt-1 backdrop-blur sm:-mx-6 sm:px-6" style={{ zIndex: "calc(var(--z-sticky) - 1)" }}>
        <div className="scroll-x -mx-1 flex gap-1 px-1 py-1" role="tablist" aria-label="Feed category">
          {cats.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={category === c.key}
              onClick={() => setParam({ category: c.key })}
              className={clsx("h-7 shrink-0 cursor-pointer rounded-md px-2.5 text-xs transition-colors", category === c.key ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
            >
              {c.label}
              {c.key !== "all" && c.key !== "watchlist" ? <span className="ml-1 font-mono text-2xs text-ink-3">{c.count}</span> : null}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <label className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-line-2 bg-surface px-2.5 focus-within:border-accent sm:w-auto sm:max-w-sm sm:flex-1">
            <Search className="size-3.5 shrink-0 text-ink-3" aria-hidden />
            <span className="sr-only">Search the feed</span>
            <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Filter by ticker, company, topic" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" />
            {qInput ? (
              <button type="button" onClick={() => setQInput("")} aria-label="Clear search" className="cursor-pointer text-ink-3 hover:text-ink">
                <X className="size-3.5" />
              </button>
            ) : null}
          </label>
          <Popover.Root>
            <Popover.Trigger asChild>
              <button type="button" className={buttonClass("outline")} aria-label="Filters">
                <SlidersHorizontal className="size-3.5" aria-hidden /> Filters
                {activeFilters.length ? <span className="rounded-sm bg-accent-dim px-1 font-mono text-2xs text-accent">{activeFilters.length}</span> : null}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="start" sideOffset={6} collisionPadding={12} className="mat-pop material-sheet w-[min(340px,calc(100vw-24px))] rounded-[18px] p-3" style={{ zIndex: "var(--z-dropdown)" }}>
                <FilterForm sp={sp} setParam={setParam} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <select
            aria-label="Sort"
            value={sp.get("sort") ?? "relevance"}
            onChange={(e) => setParam({ sort: e.target.value === "relevance" ? null : e.target.value })}
            className="h-8 cursor-pointer rounded-md border border-line-2 bg-surface px-2 text-sm text-ink"
          >
            <option value="relevance">Ranked by relevance</option>
            <option value="recency">Most recent</option>
          </select>
          <span className="ml-auto text-2xs text-ink-3" aria-live="polite">
            {loading ? "Updating…" : `${data.total} event${data.total === 1 ? "" : "s"}`}
          </span>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mb-3 rounded-md border border-neg/40 bg-neg-dim px-3 py-2 text-sm text-neg">
          {error}. Showing the last loaded results.
        </div>
      ) : null}

      <div ref={listRef} className={clsx("flex flex-col gap-3 transition-opacity", loading && "opacity-60")}>
        {data.items.map((c, i) => (
          <EventCard key={c.id} card={c} asOf={asOf} focused={i === focus} defaultHorizon={horizon} />
        ))}
      </div>

      {!data.items.length && !loading ? (
        category === "watchlist" && !state.watchlist.length ? (
          <EmptyState title="Your watchlist is empty" body="Add tickers on the Watchlists page to see a feed focused on what you track. Watchlists are stored in this browser only." action={<a href="/watchlists" className={buttonClass("primary")}>Add tickers</a>} />
        ) : (
          <EmptyState title="No events matched" body="Nothing in the current feed fits these filters." action={<button type="button" className={buttonClass("outline")} onClick={() => router.replace(pathname)}>Remove filters</button>} />
        )
      ) : null}

      {data.nextCursor ? (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={loadMore} disabled={loading} className={buttonClass("outline", "md")}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FilterRow({ label, k, options, sp, setParam }: { label: string; k: string; options: Array<[string, string]>; sp: URLSearchParams; setParam: (u: Record<string, string | null>) => void }) {
  return (
    <fieldset className="mb-3">
      <legend className="mb-1 text-2xs font-medium text-ink-3">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map(([v, l]) => {
          const active = (sp.get(k) ?? "") === v;
          return (
            <button key={v || "any"} type="button" aria-pressed={active} onClick={() => setParam({ [k]: v || null })} className={clsx("h-7 cursor-pointer rounded-md border px-2 text-xs transition-colors", active ? "border-accent/60 bg-accent-dim text-ink" : "border-line-2 text-ink-2 hover:border-ink-3")}>
              {l}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function FilterForm({ sp, setParam }: { sp: URLSearchParams; setParam: (u: Record<string, string | null>) => void }) {
  const p = { sp, setParam };
  return (
    <div>
      <FilterRow {...p} label="Impact severity (minimum)" k="severity" options={[["", "Any"], ["medium", "Medium+"], ["high", "High"]]} />
      <FilterRow {...p} label="Model direction (selected horizon)" k="direction" options={[["", "Any"], ["bullish", "Bullish"], ["bearish", "Bearish"], ["no_edge", "No edge"], ["insufficient", "Insufficient"]]} />
      <FilterRow {...p} label="Horizon shown" k="horizon" options={[["", "Default"], ["1h", "1h"], ["next_session", "Next session"], ["5_sessions", "5 sessions"]]} />
      <FilterRow {...p} label="Evidence quality (minimum)" k="minQuality" options={[["", "Any"], ["60", "60+"], ["75", "75+"], ["85", "85+"]]} />
      <FilterRow {...p} label="Recency" k="recency" options={[["", "All"], ["1h", "1h"], ["today", "24h"], ["3d", "3 days"], ["7d", "7 days"]]} />
      <FilterRow {...p} label="Verification" k="verifiedOnly" options={[["", "All sources"], ["true", "Verified only"]]} />
      <p className="text-2xs text-ink-3">Verified = original filing, official release, or multiple independent disclosures. Echoes never count as confirmation.</p>
    </div>
  );
}
