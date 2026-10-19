"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { buttonClass } from "@/components/ui/primitives";

export function TickerSearch() {
  const router = useRouter();
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const t = v.trim().toUpperCase();
        if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(t)) {
          setErr("Enter a ticker symbol such as AAPL.");
          return;
        }
        setErr(null);
        router.push(`/ticker/${t}`);
      }}
    >
      <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-line-2 bg-surface px-3 focus-within:border-accent sm:max-w-sm">
        <Search className="size-4 text-ink-3" aria-hidden />
        <span className="sr-only">Ticker symbol</span>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Ticker symbol" className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:normal-case placeholder:text-ink-3" autoComplete="off" spellCheck={false} />
      </label>
      <button type="submit" className={buttonClass("primary", "md")}>
        Open cockpit
      </button>
      {err ? (
        <p role="alert" className="w-full text-xs text-neg">
          {err}
        </p>
      ) : null}
    </form>
  );
}
