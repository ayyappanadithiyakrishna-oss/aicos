"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Beaker, AlertOctagon } from "lucide-react";
import { useQuotes } from "@/lib/useQuotes";
import { usd, pct } from "@/lib/utils";
import { Delta } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import {
  STARTING_CASH,
  checkStopLosses,
  emptyPortfolio,
  executePaperTrade,
  formatReceiptTime,
  loadPortfolio,
  markPositions,
  savePortfolio,
  type PaperPortfolioState,
} from "@/lib/paperTrading";

const ERROR = "#f0997b";

/* Paper portfolio. Marks every position to the live 15s quote poll, runs the
   8% stop on each poll, and prices every trade at the live quote — never the
   seeded book. Fresh $500 from today's prices (localStorage key _v2). */
export function PaperPortfolio({ ticker }: { ticker: string }) {
  const [portfolio, setPortfolio] = useState<PaperPortfolioState>(emptyPortfolio);
  const [hydrated, setHydrated] = useState(false);
  const [shares, setShares] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stopping = useRef(false);

  // hydrate from localStorage on the client (avoids SSR mismatch)
  useEffect(() => {
    setPortfolio(loadPortfolio());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) savePortfolio(portfolio);
  }, [portfolio, hydrated]);

  // live prices for every held symbol + the current ticker, on the 15s cycle
  const symbols = useMemo(
    () => Array.from(new Set([ticker, ...portfolio.positions.map((p) => p.symbol)])),
    [ticker, portfolio.positions],
  );
  const { quotes, updatedAt } = useQuotes(symbols);

  const priceMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of symbols) {
      const q = quotes[s];
      if (q) m[s] = q.price ?? q.last;
    }
    return m;
  }, [quotes, symbols]);

  // mark to market on every poll
  const marked = useMemo(
    () => markPositions(portfolio.positions, priceMap),
    [portfolio.positions, priceMap],
  );
  const equity = marked.reduce((s, p) => s + p.marketValue, 0);
  const totalValue = portfolio.cash + equity;
  const totalPL = totalValue - STARTING_CASH;
  const totalPLPct = (totalPL / STARTING_CASH) * 100;

  // 8% stop-loss check, evaluated against the live poll
  useEffect(() => {
    if (!hydrated || stopping.current || !updatedAt) return;
    const breaches = checkStopLosses(portfolio.positions, priceMap);
    if (breaches.length === 0) return;
    stopping.current = true;
    setPortfolio((prev) => {
      let next = prev;
      for (const b of breaches) {
        try {
          next = executePaperTrade(next, {
            symbol: b.symbol,
            side: "STOP",
            shares: b.shares,
            price: b.currentPrice,
            fetchedAt: updatedAt,
          }).portfolio;
        } catch {
          /* skip this stop if it can't apply (e.g. stale) */
        }
      }
      return next;
    });
    // release on next tick so the post-stop state settles first
    setTimeout(() => (stopping.current = false), 0);
  }, [priceMap, updatedAt, hydrated, portfolio.positions]);

  async function buy() {
    const n = Number(shares);
    if (!(n > 0)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: ticker, side: "buy", shares: n }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        fill?: { symbol: string; side: "buy"; shares: number; price: number; fetchedAt: number };
      };
      if (!res.ok || !data.fill) {
        setError(data.error ?? "Order failed");
        return;
      }
      setPortfolio((prev) => executePaperTrade(prev, data.fill!).portfolio);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Order failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col">
      {/* totals */}
      <div className="grid grid-cols-2 gap-px bg-graphite">
        <Cell label="Paper value" value={usd(totalValue)} />
        <Cell label="Cash" value={usd(portfolio.cash)} />
        <Cell label="Total P&L" value={usd(totalPL)} delta={totalPLPct} />
        <Cell label="Started" value={usd(STARTING_CASH)} />
      </div>

      {/* buy control */}
      <div className="flex items-center gap-2 border-b border-graphite px-4 py-3">
        <Beaker className="h-3.5 w-3.5 text-lilac" strokeWidth={1.5} />
        <input
          value={shares}
          onChange={(e) => setShares(e.target.value.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          className="w-12 bg-transparent text-right mono text-body-sm text-bone outline-none"
        />
        <span className="text-caption text-ash">sh</span>
        <button
          onClick={buy}
          disabled={busy}
          className="ml-auto rounded-pill bg-bone px-4 py-1.5 text-caption font-medium text-void hover:bg-frost disabled:opacity-50"
        >
          {busy ? "Pricing…" : `Buy ${ticker} (paper)`}
        </button>
      </div>
      {error && (
        <p className="mono px-4 py-2 text-[11px]" style={{ color: ERROR }}>
          {error}
        </p>
      )}

      {/* positions, marked to live */}
      {marked.length === 0 ? (
        <p className="px-4 py-4 text-caption text-mute">
          No paper positions. Prices are live — buys fill at the current quote.
        </p>
      ) : (
        <ul className="divide-y divide-graphite">
          {marked.map((p) => (
            <li key={p.symbol} className="flex items-center justify-between px-4 py-2.5">
              <div>
                <p className="text-body-sm text-bone">{p.symbol}</p>
                <p className="text-[11px] text-mute">
                  {p.shares} @ {usd(p.avgCost)} · now {usd(p.currentPrice)}
                </p>
              </div>
              <div className="text-right">
                <p className="mono text-body-sm text-frost">{usd(p.marketValue)}</p>
                <Delta value={p.unrealizedPL} className="text-[11px]">
                  {pct(p.unrealizedPLPct)}
                </Delta>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* receipts */}
      {portfolio.trades.length > 0 && (
        <div className="border-t border-graphite">
          <p className="eyebrow px-4 pt-3 pb-1">Receipts</p>
          <ul className="divide-y divide-graphite">
            {portfolio.trades.slice(0, 8).map((t) => {
              const isStop = t.side === "STOP";
              return (
                <li key={t.id} className="px-4 py-2">
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "mono text-[11px] font-medium uppercase",
                        isStop ? "" : t.side === "buy" ? "text-bull" : "text-bear",
                      )}
                      style={isStop ? { color: ERROR } : undefined}
                    >
                      {isStop && <AlertOctagon className="mr-1 inline h-3 w-3" strokeWidth={1.5} />}
                      {t.side} {t.shares} {t.symbol} @ {usd(t.price)}
                    </span>
                    {isStop && t.realizedPL != null && (
                      <span className="mono text-[11px]" style={{ color: ERROR }}>
                        {usd(t.realizedPL)}
                      </span>
                    )}
                  </div>
                  <p className="mono mt-0.5 text-[11px] text-ash">
                    {isStop && t.triggerPrice != null
                      ? `Stop @ ${usd(t.triggerPrice)} · `
                      : ""}
                    {formatReceiptTime(t.executedAt)}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
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
