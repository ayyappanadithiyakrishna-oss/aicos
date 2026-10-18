"use client";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FileText, LineChart, Search } from "lucide-react";
import { NAV } from "./nav";
import type { SearchHit } from "@/lib/data/views";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      if (!q.trim()) {
        setHits([]);
        return;
      }
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: c.signal });
        if (res.ok) setHits(((await res.json()) as { hits: SearchHit[] }).hits);
      } catch {
        /* aborted or offline: keep previous results */
      } finally {
        setLoading(false);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Search SIGNAL"
      shouldFilter={false}
      className="fixed left-1/2 top-[12vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-lg border border-line-2 bg-surface shadow-2xl"
      overlayClassName="fixed inset-0 bg-black/50 backdrop-blur-[2px]"
      contentClassName="contents"
      style={{ zIndex: "var(--z-modal)" }}
    >
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search className="size-4 text-ink-3" aria-hidden />
        <Command.Input value={q} onValueChange={setQ} placeholder="Search tickers, events, pages…" className="h-11 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-ink-3" />
        {loading ? <span className="text-2xs text-ink-3">Searching…</span> : null}
      </div>
      <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-sm text-ink-2">No matches. Try a ticker like HLCN or a phrase like “inflation”.</Command.Empty>
        {hits.length ? (
          <Command.Group heading="Results" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:text-ink-3">
            {hits.map((h) => (
              <Command.Item key={`${h.kind}:${h.id}`} value={`${h.kind}:${h.id}`} onSelect={() => go(h.href)} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm text-ink-2 data-[selected=true]:bg-surface-2 data-[selected=true]:text-ink">
                {h.kind === "ticker" ? <LineChart className="size-4 text-accent" aria-hidden /> : <FileText className="size-4 text-ink-3" aria-hidden />}
                <span className={h.kind === "ticker" ? "font-mono font-semibold text-ink" : "truncate"}>{h.label}</span>
                <span className="ml-auto truncate text-2xs text-ink-3">{h.sublabel}</span>
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
        <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:text-ink-3">
          {NAV.filter((n) => !q || n.label.toLowerCase().includes(q.toLowerCase())).map((n) => {
            const Icon = n.icon;
            return (
              <Command.Item key={n.href} value={`nav:${n.href}`} onSelect={() => go(n.href)} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm text-ink-2 data-[selected=true]:bg-surface-2 data-[selected=true]:text-ink">
                <Icon className="size-4 text-ink-3" aria-hidden />
                {n.label}
                {n.shortcut ? <span className="ml-auto font-mono text-2xs text-ink-3">{n.shortcut}</span> : null}
              </Command.Item>
            );
          })}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
