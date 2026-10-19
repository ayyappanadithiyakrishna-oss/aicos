"use client";
import Link from "next/link";
import { useEffect } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Bell } from "lucide-react";
import { matchAlerts, type AlertableEvent } from "@/lib/alerts/match";
import { useClientState } from "@/lib/client/store";
import type { CardModel } from "@/lib/data/cards";

export function toAlertable(c: CardModel): AlertableEvent {
  return {
    id: c.id,
    firstPublishedAt: c.firstPublishedAt,
    severity: c.severity,
    quality: c.quality,
    bottomLine: c.bottomLine,
    tags: c.tags,
    exposures: c.exposures.map((x) => ({ ticker: x.ticker, directness: x.directness, forecasts: x.forecasts })),
  };
}

export function AlertsBell() {
  const [state, update] = useClientState();
  const unread = state.deliveries.filter((d) => !d.read && d.status === "delivered").length;

  useEffect(() => {
    if (!state.rules.some((r) => !r.paused)) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch("/api/feed?limit=100&format=card");
        if (!res.ok) return;
        const data = (await res.json()) as { items: CardModel[] };
        if (cancelled) return;
        update((s) => {
          const fresh = matchAlerts(data.items.map(toAlertable), s.rules, s.deliveries, new Date());
          return fresh.length ? { ...s, deliveries: [...fresh, ...s.deliveries].slice(0, 200) } : s;
        });
      } catch {
        /* offline: alerts resume on next poll */
      }
    };
    void run();
    const id = setInterval(run, 120_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [state.rules, update]);

  const recent = state.deliveries.filter((d) => d.status !== "digested").slice(0, 8);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="relative inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={unread ? `Alerts, ${unread} unread` : "Alerts"}>
          <Bell className="size-4" />
          {unread ? <span className="absolute right-1 top-1 min-w-3.5 rounded-full bg-accent px-0.5 text-center font-mono text-[9px] font-semibold leading-3.5 text-accent-ink">{unread > 9 ? "9+" : unread}</span> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="mat-pop material-sheet w-[min(360px,calc(100vw-24px))] rounded-[18px] p-2" style={{ zIndex: "var(--z-dropdown)" }}>
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-semibold text-ink">In-app alerts</span>
            {unread ? (
              <button type="button" className="cursor-pointer text-2xs text-accent hover:underline" onClick={() => update((s) => ({ ...s, deliveries: s.deliveries.map((d) => ({ ...d, read: true })) }))}>
                Mark all read
              </button>
            ) : null}
          </div>
          {recent.length ? (
            <ul className="max-h-80 overflow-y-auto">
              {recent.map((d) => (
                <li key={d.id}>
                  <Link href={`/events/${d.eventId}`} className="block rounded-md px-2 py-2 hover:bg-surface-2" onClick={() => update((s) => ({ ...s, deliveries: s.deliveries.map((x) => (x.id === d.id ? { ...x, read: true } : x)) }))}>
                    <div className="flex items-center gap-1.5 text-2xs text-ink-3">
                      {!d.read ? <span className="size-1.5 rounded-full bg-accent" /> : null}
                      {d.reason}
                      {d.status === "throttled" ? <span className="text-warn">· throttled</span> : null}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-sm text-ink-2">{d.title}</div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-4 text-sm text-ink-2">{state.rules.length ? "No matching events yet." : "No alert rules. Create one to get in-app alerts for your tickers."}</p>
          )}
          <Link href="/alerts" className="mt-1 block rounded-md px-2 py-1.5 text-center text-xs text-accent hover:bg-surface-2">
            Manage alert rules
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
