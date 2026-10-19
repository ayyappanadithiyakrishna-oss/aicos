"use client";
import Link from "next/link";
import { useState } from "react";
import { X } from "lucide-react";
import { useClientState } from "@/lib/client/store";
import { buttonClass, EmptyState } from "@/components/ui/primitives";
import { Monogram } from "@/components/ui/SecurityMark";

export function Watchlists({ universe }: { universe: Array<{ ticker: string; name: string }> }) {
  const [state, update] = useClientState();
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const known = new Map(universe.map((u) => [u.ticker, u.name] as const));
  const add = () => {
    const t = v.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(t)) return setErr("Enter a valid ticker symbol.");
    if (universe.length && !known.has(t)) return setErr(`${t} is not in the security master for this mode.`);
    if (state.watchlist.includes(t)) return setErr(`${t} is already on your watchlist.`);
    update((s) => ({ ...s, watchlist: [...s.watchlist, t] }));
    setV("");
    setErr(null);
  };
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <label className="sr-only" htmlFor="wl-add">
          Ticker to add
        </label>
        <input id="wl-add" list="wl-universe" value={v} onChange={(e) => setV(e.target.value)} placeholder="Add ticker" className="h-9 w-44 rounded-md border border-line-2 bg-surface px-3 font-mono text-sm outline-none placeholder:normal-case placeholder:text-ink-3 focus:border-accent" />
        <datalist id="wl-universe">
          {universe.map((u) => (
            <option key={u.ticker} value={u.ticker}>
              {u.name}
            </option>
          ))}
        </datalist>
        <button type="submit" className={buttonClass("primary", "md")}>
          Add
        </button>
        {err ? (
          <span role="alert" className="text-xs text-neg">
            {err}
          </span>
        ) : null}
      </form>
      <div className="mt-5">
        {state.watchlist.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {state.watchlist.map((t) => (
              <li key={t} className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5">
                <Monogram ticker={t} size={24} />
                <Link href={`/ticker/${t}`} className="font-mono text-sm font-semibold hover:text-accent">
                  {t}
                </Link>
                <span className="truncate text-xs text-ink-3">{known.get(t) ?? ""}</span>
                <button type="button" onClick={() => update((s) => ({ ...s, watchlist: s.watchlist.filter((x) => x !== t) }))} aria-label={`Remove ${t}`} className="ml-auto inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink">
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No tickers yet" body="Add tickers to get a watchlist-focused feed, calendar filter and alert rules." />
        )}
      </div>
      {state.watchlist.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/?category=watchlist" className={buttonClass("outline", "md")}>
            Open watchlist feed
          </Link>
          <Link href="/alerts" className={buttonClass("ghost", "md")}>
            Create an alert for these tickers
          </Link>
        </div>
      ) : null}
    </div>
  );
}
