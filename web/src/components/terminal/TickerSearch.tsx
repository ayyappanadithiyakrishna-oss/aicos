"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { WATCHLIST } from "@/lib/demo";
import { cn } from "@/lib/utils";

interface Result {
  symbol: string;
  name: string;
  type?: string;
}

const DEFAULTS: Result[] = WATCHLIST.map((w) => ({ symbol: w.ticker, name: w.name }));

/* Universal ticker search. Free-text → tradable ticker via /api/search
   (Robinhood `search` tool). Keyboard navigable, 300ms debounce, watchlist
   defaults when empty. Selecting resolves to the existing onSelect handler. */
export function TickerSearch({
  onSelect,
  current,
}: {
  onSelect: (symbol: string) => void;
  current?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Result[]>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // debounced search
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(DEFAULTS);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as { results?: Result[] };
        setResults(data.results?.length ? data.results : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => setActive(0), [results, open]);

  // dismiss on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(r: Result) {
    onSelect(r.symbol);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) choose(results[active]);
      else if (query.trim())
        choose({ symbol: query.trim().toUpperCase(), name: query.trim().toUpperCase() });
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <Search
        className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-mute"
        strokeWidth={1.5}
      />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value.toUpperCase())}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search any ticker or company — the committee convenes"
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-pill border border-graphite bg-void py-3 pl-11 pr-10 text-body-sm text-bone placeholder:text-mute outline-none focus:border-ash"
      />
      {loading && (
        <span
          className="absolute right-4 top-1/2 h-2 w-2 -translate-y-1/2 rounded-pill bg-ash breathe"
          aria-label="searching"
        />
      )}

      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-2 max-h-80 w-full overflow-y-auto rounded-cards border border-graphite bg-[#111111] py-1 [box-shadow:var(--shadow-subtle)]"
        >
          {query.trim() === "" && (
            <li className="eyebrow px-4 py-2">Watchlist</li>
          )}
          {results.length === 0 && !loading && (
            <li className="px-4 py-3 text-body-sm text-ash">
              No matches for “{query}”.
            </li>
          )}
          {results.map((r, i) => (
            <li key={`${r.symbol}-${i}`} role="option" aria-selected={i === active}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                className={cn(
                  "flex w-full items-baseline gap-3 px-4 py-2.5 text-left transition-colors",
                  i === active ? "bg-bone/[0.06]" : "hover:bg-bone/[0.03]",
                )}
              >
                <span
                  className={cn(
                    "font-geist text-body text-bone",
                    current === r.symbol && "text-lilac",
                  )}
                >
                  {r.symbol}
                </span>
                <span className="truncate font-inter text-[13px] text-ash">
                  {r.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
