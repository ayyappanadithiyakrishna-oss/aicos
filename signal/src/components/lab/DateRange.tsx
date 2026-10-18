"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function DateRange() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = (k: "from" | "to", v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
      <label className="flex items-center gap-1.5">
        From
        <input type="date" value={sp.get("from") ?? ""} onChange={(e) => set("from", e.target.value)} className="h-8 rounded-md border border-line-2 bg-surface px-2 text-sm text-ink [color-scheme:inherit]" />
      </label>
      <label className="flex items-center gap-1.5">
        To
        <input type="date" value={sp.get("to") ?? ""} onChange={(e) => set("to", e.target.value)} className="h-8 rounded-md border border-line-2 bg-surface px-2 text-sm text-ink [color-scheme:inherit]" />
      </label>
    </div>
  );
}
