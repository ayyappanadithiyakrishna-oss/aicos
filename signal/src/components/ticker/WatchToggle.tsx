"use client";
import { Star } from "lucide-react";
import { useClientState } from "@/lib/client/store";
import { buttonClass } from "@/components/ui/primitives";

export function WatchToggle({ ticker }: { ticker: string }) {
  const [state, update] = useClientState();
  const on = state.watchlist.includes(ticker);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => update((s) => ({ ...s, watchlist: on ? s.watchlist.filter((t) => t !== ticker) : [...s.watchlist, ticker] }))}
      className={buttonClass(on ? "primary" : "outline")}
      title="Stored in this browser only"
    >
      <Star className="size-3.5" aria-hidden fill={on ? "currentColor" : "none"} />
      {on ? "Watching" : "Watch"}
    </button>
  );
}
