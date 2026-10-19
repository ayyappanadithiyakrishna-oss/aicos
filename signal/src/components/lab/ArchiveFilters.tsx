"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

function Sel({ k, label, options, sp, set }: { k: string; label: string; options: Array<[string, string]>; sp: URLSearchParams; set: (k: string, v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-3">
      {label}
      <select value={sp.get(k) ?? ""} onChange={(e) => set(k, e.target.value)} className="h-8 cursor-pointer rounded-md border border-line-2 bg-surface px-2 text-sm text-ink">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ArchiveFilters() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [ticker, setTicker] = useState(sp.get("ticker") ?? "");
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    p.delete("cursor");
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`${pathname}?${p.toString()}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          set("ticker", ticker.trim().toUpperCase());
        }}
        className="flex items-center gap-1.5"
      >
        <label className="flex items-center gap-1.5 text-xs text-ink-3">
          Ticker
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Any" className="h-8 w-24 rounded-md border border-line-2 bg-surface px-2 font-mono text-sm text-ink outline-none placeholder:normal-case focus:border-accent" />
        </label>
      </form>
      <Sel sp={sp} set={set} k="horizon" label="Horizon" options={[["", "All"], ["1h", "1h"], ["next_session", "Next session"], ["5_sessions", "5 sessions"]]} />
      <Sel sp={sp} set={set} k="sample" label="Sample" options={[["", "All"], ["current", "Current events"], ["oos", "Walk-forward OOS"]]} />
      <Sel sp={sp} set={set} k="status" label="Status" options={[["", "All"], ["pending", "Pending"], ["resolved", "Resolved"], ["failed", "Failed"], ["not_resolvable", "Not resolvable"]]} />
    </div>
  );
}
