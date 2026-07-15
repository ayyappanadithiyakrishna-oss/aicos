"use client";

import { getQuote } from "@/lib/market";
import { HOLDINGS, WATCHLIST, NEWS, MACRO, portfolioStats } from "@/lib/demo";
import { usd, pct, compact } from "@/lib/utils";
import { Delta } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface OrderRow {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  state: string;
}

const ORDER_STATE_TONE: Record<string, string> = {
  queued: "text-warn",
  unconfirmed: "text-warn",
  confirmed: "text-frost",
  partially_filled: "text-warn",
  filled: "text-bull",
  cancelled: "text-mute",
  rejected: "text-bear",
};

export function PortfolioPanel({
  onSelect,
  orders = [],
}: {
  onSelect: (t: string) => void;
  orders?: OrderRow[];
}) {
  const s = portfolioStats();
  const openOrders = orders.filter((o) =>
    ["queued", "unconfirmed", "confirmed", "partially_filled"].includes(
      o.state.toLowerCase(),
    ),
  );
  return (
    <div className="flex flex-col">
      {openOrders.length > 0 && (
        <div className="border-b border-graphite">
          <p className="eyebrow px-4 pt-3 pb-1">Open orders · ••••8815</p>
          <ul className="divide-y divide-graphite">
            {openOrders.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between px-4 py-2 text-body-sm"
              >
                <span className="text-bone">
                  <span className="capitalize text-ash">{o.side}</span> {o.quantity}{" "}
                  {o.symbol}
                </span>
                <span
                  className={cn(
                    "mono text-[11px] capitalize",
                    ORDER_STATE_TONE[o.state.toLowerCase()] ?? "text-ash",
                  )}
                >
                  {o.state.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-2 gap-px bg-graphite">
        <Cell label="Net liquidity" value={usd(s.total, { maximumFractionDigits: 0 })} />
        <Cell label="Buying power" value={usd(s.buyingPower, { maximumFractionDigits: 0 })} />
        <Cell
          label="Day P&L"
          value={usd(s.dayPnl, { maximumFractionDigits: 0 })}
          delta={s.dayPnlPct}
        />
        <Cell
          label="Total P&L"
          value={usd(s.totalPnl, { maximumFractionDigits: 0 })}
          delta={s.totalPnlPct}
        />
      </div>
      <ul className="divide-y divide-graphite">
        {HOLDINGS.map((h) => {
          const mv = h.shares * h.last;
          const plPct = (h.last / h.avgCost - 1) * 100;
          const q = getQuote(h.ticker);
          return (
            <li key={h.ticker}>
              <button
                onClick={() => onSelect(h.ticker)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-bone/[0.03]"
              >
                <div>
                  <p className="text-body-sm text-bone">{h.ticker}</p>
                  <p className="text-[11px] text-mute">
                    {h.shares} @ {usd(h.avgCost)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="mono text-body-sm text-frost">
                    {usd(mv, { maximumFractionDigits: 0 })}
                  </p>
                  <Delta value={q.change} className="text-[11px]">
                    {pct(plPct)}
                  </Delta>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Cell({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: number;
}) {
  return (
    <div className="bg-carbon px-4 py-2.5">
      <p className="text-[11px] text-mute">{label}</p>
      <p className="mono mt-0.5 text-body-sm text-bone">{value}</p>
      {delta !== undefined && (
        <Delta value={delta} className="text-[11px]">
          {pct(delta)}
        </Delta>
      )}
    </div>
  );
}

export function WatchlistPanel({
  onSelect,
  active,
  quotes,
}: {
  onSelect: (t: string) => void;
  active: string;
  quotes?: Record<string, { last: number; changePct: number }>;
}) {
  return (
    <ul className="divide-y divide-graphite">
      {WATCHLIST.map((w) => {
        const q = quotes?.[w.ticker];
        const last = q?.last ?? w.last;
        const changePct = q?.changePct ?? w.changePct;
        return (
          <li key={w.ticker}>
            <button
              onClick={() => onSelect(w.ticker)}
              className={cn(
                "flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-bone/[0.03]",
                active === w.ticker && "bg-bone/[0.04]",
              )}
            >
              <div className="min-w-0">
                <p className="text-body-sm text-bone">{w.ticker}</p>
                <p className="truncate text-[11px] text-mute">{w.sector}</p>
              </div>
              <div className="text-right">
                <p className="mono text-body-sm text-frost">{usd(last)}</p>
                <Delta value={changePct} className="text-[11px]">
                  {pct(changePct)}
                </Delta>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function NewsPanel() {
  const tone = { pos: "text-bull", neg: "text-bear", neu: "text-ash" } as const;
  return (
    <ul className="divide-y divide-graphite">
      {NEWS.map((n, i) => (
        <li key={i} className="px-4 py-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-frost">{n.source}</span>
            <span className="text-mute">{n.time} ago</span>
          </div>
          <p className="mt-1 text-body-sm leading-snug text-ash">
            <span className={cn("mr-1.5", tone[n.sentiment])}>●</span>
            {n.headline}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function MacroBar() {
  const tone = { pos: "text-bull", neg: "text-bear", neu: "text-ash" } as const;
  // Duplicate items so the marquee loops seamlessly
  const items = [...MACRO, ...MACRO];
  return (
    <div className="relative overflow-hidden">
      {/* fade edges */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-void to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-void to-transparent" />
      <div className="flex animate-marquee items-center gap-10 py-2.5 will-change-transform">
        {items.map((m, i) => (
          <div key={`${m.label}-${i}`} className="flex shrink-0 items-baseline gap-2">
            <span className="eyebrow">{m.label}</span>
            <span className="mono text-body-sm text-bone">{m.value}</span>
            <span className={cn("mono text-[11px]", tone[m.tone])}>{m.delta}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
