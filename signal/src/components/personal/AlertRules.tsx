"use client";
import Link from "next/link";
import { useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import type { AlertKind, AlertRule } from "@/lib/alerts/match";
import { useClientState } from "@/lib/client/store";
import { buttonClass, Chip, EmptyState } from "@/components/ui/primitives";

const KIND_LABEL: Record<AlertKind, string> = {
  watchlist_material: "High-materiality event on my tickers",
  ticker_any: "Any event on my tickers",
  filing: "New filing for my tickers",
  second_order: "New second-order exposure for my tickers",
  forecast_invalidation: "Realized move falls outside the forecast interval",
  quality_change: "High-quality evidence on my tickers",
};

export function AlertRules() {
  const [state, update] = useClientState();
  const [kind, setKind] = useState<AlertKind>("watchlist_material");
  const [sev, setSev] = useState<AlertRule["minSeverity"]>("medium");
  const [minQ, setMinQ] = useState(60);
  const [maxPerHour, setMax] = useState(6);
  const [digest, setDigest] = useState(false);
  const create = () => {
    if (!state.watchlist.length) return;
    const rule: AlertRule = {
      id: `r${Date.now().toString(36)}`,
      kind,
      label: KIND_LABEL[kind],
      tickers: state.watchlist,
      minSeverity: sev,
      minQuality: minQ,
      paused: false,
      digest,
      maxPerHour,
      createdAt: new Date().toISOString(),
    };
    update((s) => ({ ...s, rules: [rule, ...s.rules] }));
  };
  const deliveries = state.deliveries;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-xs font-semibold text-ink-2">New rule</h2>
        {!state.watchlist.length ? (
          <p className="mt-2 text-sm text-ink-2">
            Rules match your watchlist. <Link href="/watchlists" className="text-accent hover:underline">Add tickers first.</Link>
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
            className="mt-3 space-y-3 text-sm"
          >
            <label className="block">
              <span className="text-2xs text-ink-3">Trigger</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as AlertKind)} className="mt-1 h-9 w-full cursor-pointer rounded-md border border-line-2 bg-surface px-2 text-sm">
                {Object.entries(KIND_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-2xs text-ink-3">Minimum severity</span>
                <select value={sev} onChange={(e) => setSev(e.target.value as AlertRule["minSeverity"])} className="mt-1 h-9 w-full cursor-pointer rounded-md border border-line-2 bg-surface px-2 text-sm">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="block">
                <span className="text-2xs text-ink-3">Minimum evidence quality</span>
                <input type="number" min={0} max={100} value={minQ} onChange={(e) => setMinQ(Math.max(0, Math.min(100, Number(e.target.value))))} className="mt-1 h-9 w-full rounded-md border border-line-2 bg-surface px-2 font-mono text-sm" />
              </label>
              <label className="block">
                <span className="text-2xs text-ink-3">Max alerts per hour</span>
                <input type="number" min={1} max={60} value={maxPerHour} onChange={(e) => setMax(Math.max(1, Math.min(60, Number(e.target.value))))} className="mt-1 h-9 w-full rounded-md border border-line-2 bg-surface px-2 font-mono text-sm" />
              </label>
              <label className="mt-5 flex cursor-pointer items-center gap-2 text-xs text-ink-2">
                <input type="checkbox" checked={digest} onChange={(e) => setDigest(e.target.checked)} className="accent-[var(--accent)]" /> Digest instead of individual alerts
              </label>
            </div>
            <p className="text-2xs text-ink-3">Applies to: {state.watchlist.join(", ")}. Syndicated duplicates never re-fire — matching is per event cluster.</p>
            <button type="submit" className={buttonClass("primary", "md")}>
              Create rule
            </button>
          </form>
        )}
        <div className="mt-5">
          <h2 className="text-xs font-semibold text-ink-2">Rules</h2>
          {state.rules.length ? (
            <ul className="mt-2 divide-y divide-line">
              {state.rules.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-ink">{r.label}</div>
                    <div className="text-2xs text-ink-3">
                      {r.tickers.join(", ")} · ≥{r.minSeverity} · Q≥{r.minQuality} · ≤{r.maxPerHour}/h{r.digest ? " · digest" : ""}
                    </div>
                  </div>
                  {r.paused ? <Chip tone="warn">Paused</Chip> : null}
                  <button type="button" onClick={() => update((s) => ({ ...s, rules: s.rules.map((x) => (x.id === r.id ? { ...x, paused: !x.paused } : x)) }))} aria-label={r.paused ? "Resume rule" : "Pause rule"} className="ml-auto inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink">
                    {r.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                  </button>
                  <button type="button" onClick={() => update((s) => ({ ...s, rules: s.rules.filter((x) => x.id !== r.id) }))} aria-label="Delete rule" className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-neg">
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-3">No rules yet.</p>
          )}
        </div>
      </section>
      <section className="rounded-lg border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-ink-2">Delivery log</h2>
          {deliveries.length ? (
            <button type="button" onClick={() => update((s) => ({ ...s, deliveries: [] }))} className="cursor-pointer text-2xs text-ink-3 hover:text-ink">
              Clear
            </button>
          ) : null}
        </div>
        {deliveries.length ? (
          <ul className="mt-2 divide-y divide-line">
            {deliveries.slice(0, 50).map((d) => (
              <li key={d.id} className="py-2 text-xs">
                <div className="flex items-center gap-1.5 text-2xs text-ink-3">
                  <Chip tone={d.status === "delivered" ? "accent" : d.status === "throttled" ? "warn" : "muted"}>{d.status}</Chip>
                  {d.reason}
                </div>
                <Link href={`/events/${d.eventId}`} className="mt-0.5 line-clamp-2 text-ink-2 hover:text-ink">
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing delivered yet" body="Matches appear here and in the bell menu. In-app only: email and push need a configured delivery provider, which this deployment does not have." />
        )}
      </section>
    </div>
  );
}
