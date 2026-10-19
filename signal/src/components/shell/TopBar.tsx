"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { Search, Settings, Star } from "lucide-react";
import type { ModeInfo } from "@/lib/data/views";
import { useClientState } from "@/lib/client/store";
import { CommandPalette } from "./CommandPalette";
import { NavSheet } from "./NavSheet";
import { AlertsBell } from "./AlertsBell";
import { NAV } from "./nav";
import { Kbd } from "@/components/ui/primitives";

const SESSION_LABEL: Record<ModeInfo["clock"]["state"], string> = {
  pre_market: "Pre-market",
  regular: "Regular session",
  post_market: "After hours",
  closed: "Market closed",
};

function Clock({ mode }: { mode: ModeInfo }) {
  const [settings] = useClientState();
  const [now, setNow] = useState<string>(mode.asOf);
  useEffect(() => {
    if (mode.mode === "demo") return;
    const id = setInterval(() => setNow(new Date().toISOString()), 30_000);
    return () => clearInterval(id);
  }, [mode.mode]);
  const d = new Date(mode.mode === "demo" ? mode.asOf : now);
  const tz = settings.settings.timeDisplay;
  const fmt = (timeZone: string | undefined) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const primary = tz === "utc" ? `${fmt("UTC")} UTC` : tz === "local" ? `${fmt(undefined)} local` : `${fmt("America/New_York")} ET`;
  const secondary = tz === "utc" ? `${fmt("America/New_York")} ET` : `${fmt("UTC")} UTC`;
  return (
    <div className="hidden items-center gap-2 text-xs md:flex" aria-label="As of time">
      <span className="text-ink-3">As of</span>
      <span className="num font-mono text-ink">{primary}</span>
      <span className="num font-mono text-ink-3">{secondary}</span>
    </div>
  );
}

export function TopBar({ mode }: { mode: ModeInfo }) {
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.key === "?") {
        setHelp((h) => !h);
        return;
      }
      if (pending.current === "g") {
        const item = NAV.find((n) => n.shortcut === `g ${e.key}`);
        pending.current = null;
        if (item) router.push(item.href);
        return;
      }
      if (e.key === "g") {
        pending.current = "g";
        setTimeout(() => (pending.current = null), 1200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const state = mode.clock.state;
  return (
    <header className="material-chrome sticky top-0 text-[var(--nav-ink)]" style={{ zIndex: "var(--z-sticky)" }}>
      <div className="flex h-11 items-center gap-2 px-3 sm:gap-3 sm:px-4 [&_.text-ink]:text-[var(--nav-ink)] [&_.text-ink-2]:text-[var(--nav-ink-2)] [&_.text-ink-3]:text-[var(--nav-ink-2)]">
        <NavSheet open={navOpen} onOpenChange={setNavOpen} />

        <Link href="/" className="flex items-center gap-2" aria-label="SIGNAL home">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <rect x="1" y="9" width="3" height="8" rx="1.5" fill="currentColor" opacity="0.45" />
            <rect x="7.5" y="5" width="3" height="12" rx="1.5" fill="currentColor" opacity="0.7" />
            <rect x="14" y="1" width="3" height="16" rx="1.5" fill="currentColor" />
          </svg>
          <span className="text-[15px] font-semibold text-ink">Signal</span>
        </Link>
        {mode.mode === "demo" ? (
          <span className="hidden rounded-full bg-[#ff9f0a]/25 px-2 text-2xs font-medium text-[#ffd08a] sm:inline">Demo</span>
        ) : null}

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="ml-1 flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-full bg-white/10 px-3 text-left text-sm text-ink-3 transition-colors hover:bg-white/15 sm:max-w-[420px]"
          aria-label="Search tickers, events and pages"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="truncate">Search tickers, events…</span>
          <span className="ml-auto hidden items-center gap-1 sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>

        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          <Clock mode={mode} />
          <div className="hidden items-center gap-1.5 text-xs xl:flex" title={mode.clock.holiday ? `Holiday: ${mode.clock.holiday.name}` : mode.clock.earlyClose ?? undefined}>
            <span className={clsx("inline-block size-1.5 rounded-full", state === "regular" ? "live-dot bg-pos" : state === "closed" ? "bg-ink-3" : "bg-warn")} />
            <span className="text-ink-2">{SESSION_LABEL[state]}</span>
          </div>
          <Link href="/status" className="hidden h-8 items-center gap-1.5 rounded-md px-2 text-xs text-ink-2 hover:bg-white/10 hover:text-white sm:flex" title="Data health and feed latency">
            <span className={clsx("inline-block size-1.5 rounded-full", mode.mode === "demo" ? "bg-warn" : mode.priceEntitlement === "none" ? "bg-ink-3" : "bg-accent")} />
            {mode.mode === "demo" ? "Synthetic" : mode.label === "LIVE" ? "Live" : "No providers"}
          </Link>
          <Link href="/watchlists" className="inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-white/10 hover:text-white" aria-label="Watchlists">
            <Star className="size-4" />
          </Link>
          <AlertsBell />
          <Link href="/settings" className="hidden size-8 items-center justify-center rounded-md text-ink-2 hover:bg-white/10 hover:text-white sm:inline-flex" aria-label="Settings">
            <Settings className="size-4" />
          </Link>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Dialog.Root open={help} onOpenChange={setHelp}>
        <Dialog.Portal>
          <Dialog.Overlay className="mat-scrim fixed inset-0 bg-black/40" style={{ zIndex: "var(--z-overlay)" }} />
          <Dialog.Content className="mat-dialog material-sheet fixed left-1/2 top-[15vh] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 rounded-[18px] p-5" style={{ zIndex: "var(--z-modal)" }} aria-describedby={undefined}>
            <Dialog.Title className="mb-3 text-md font-semibold">Keyboard shortcuts</Dialog.Title>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt><Kbd>⌘ K</Kbd> / <Kbd>/</Kbd></dt>
              <dd className="text-ink-2">Search</dd>
              <dt><Kbd>j</Kbd> <Kbd>k</Kbd></dt>
              <dd className="text-ink-2">Next / previous card</dd>
              <dt><Kbd>o</Kbd></dt>
              <dd className="text-ink-2">Expand mechanics</dd>
              <dt><Kbd>b</Kbd></dt>
              <dd className="text-ink-2">Bookmark card</dd>
              {NAV.filter((n) => n.shortcut).map((n) => (
                <div key={n.href} className="contents">
                  <dt><Kbd>{n.shortcut}</Kbd></dt>
                  <dd className="text-ink-2">{n.label}</dd>
                </div>
              ))}
            </dl>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </header>
  );
}
