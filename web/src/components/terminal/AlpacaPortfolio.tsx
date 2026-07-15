"use client";

import { useState } from "react";
import { Wallet, Plug, X, TrendingUp } from "lucide-react";
import { useAlpaca } from "@/lib/useAlpaca";
import type { Decision } from "@/lib/committee";
import type { Quote } from "@/lib/market";
import { usd, pct, cn } from "@/lib/utils";
import { Delta } from "@/components/ui/primitives";

const n = (s: string | null | undefined) => (s == null ? 0 : Number(s));

/* The live Alpaca paper account — the terminal's execution engine.
   Marks positions to Alpaca's own pricing, submits market or bracket orders,
   and lets the committee's ruling flow straight to the broker. Renders a clean
   connect prompt when APCA keys aren't set. */
export function AlpacaPortfolio({
  ticker,
  quote,
  verdict,
  referencePrice,
}: {
  ticker: string;
  quote: Quote;
  verdict?: Decision;
  referencePrice?: number;
}) {
  const { snapshot, loading, error, refetch } = useAlpaca();
  const [shares, setShares] = useState("1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const last = quote.price ?? quote.last ?? referencePrice ?? 0;

  async function submit(body: Record<string, unknown>, label: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/alpaca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Order rejected");
      setMsg({ kind: "ok", text: `${label} submitted` });
      await refetch();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Order failed" });
    } finally {
      setBusy(false);
    }
  }

  async function liquidate(symbol: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/alpaca?position=${encodeURIComponent(symbol)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Close failed");
      setMsg({ kind: "ok", text: `Closing ${symbol}` });
      await refetch();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Close failed" });
    } finally {
      setBusy(false);
    }
  }

  /* ── Loading (first fetch) — avoid flashing a fake $0.00 account ── */
  if (loading && !snapshot.account) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-body-sm text-mute">
        <span className="h-1.5 w-1.5 rounded-pill bg-ash breathe" />
        Connecting to Alpaca…
      </div>
    );
  }

  /* ── Not connected ─────────────────────────────────────────── */
  if (!snapshot.connected) {
    return (
      <div className="grid place-items-center px-6 py-10 text-center">
        <div className="grid h-11 w-11 place-items-center rounded-pill bg-obsidian">
          <Plug className="h-5 w-5 text-cobalt" strokeWidth={1.5} />
        </div>
        <p className="mt-4 text-body text-bone">Connect Alpaca paper</p>
        <p className="mt-2 max-w-[15rem] text-body-sm text-ash">
          Add your paper keys to <span className="mono text-frost">.env.local</span> to
          trade live:
        </p>
        <pre className="mono mt-3 w-full overflow-x-auto rounded-images bg-void px-3 py-2 text-left text-[11px] text-ash">
          APCA_API_KEY_ID=…{"\n"}APCA_API_SECRET_KEY=…
        </pre>
        <a
          href="https://app.alpaca.markets/paper/dashboard/overview"
          target="_blank"
          rel="noreferrer"
          className="mt-3 text-body-sm font-medium text-cobalt hover:underline"
        >
          Get paper keys →
        </a>
      </div>
    );
  }

  const acct = snapshot.account;
  const equity = n(acct?.portfolio_value ?? acct?.equity);
  const lastEquity = n(acct?.last_equity);
  const dayPL = equity - lastEquity;
  const dayPLPct = lastEquity ? dayPL / lastEquity : 0;
  const positions = snapshot.positions ?? [];
  const orders = (snapshot.orders ?? []).filter((o) =>
    ["new", "accepted", "partially_filled", "filled", "held", "pending_new"].includes(o.status),
  );

  const canBracket =
    verdict && verdict.verdict === "BUY" && verdict.stop > 0 && verdict.priceTarget > 0;

  return (
    <div className="flex flex-col">
      {/* account header */}
      <div className="border-b border-graphite px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-caption text-ash">
            <Wallet className="h-3.5 w-3.5" strokeWidth={1.5} /> Alpaca Paper
          </span>
          <span className="mono flex items-center gap-1.5 text-[10px] text-mute">
            <span className="h-1.5 w-1.5 rounded-pill bg-bull breathe" /> LIVE
          </span>
        </div>
        <p className="mono mt-2 text-heading-sm tabular-nums text-bone">{usd(equity)}</p>
        <div className="mt-1 flex items-center gap-3 text-body-sm">
          <Delta value={dayPL}>
            {dayPL >= 0 ? "+" : ""}
            {usd(dayPL)} ({pct(dayPLPct * 100)})
          </Delta>
          <span className="text-mute">today</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-caption">
          <Stat label="Cash" value={usd(n(acct?.cash))} />
          <Stat label="Buying power" value={usd(n(acct?.buying_power))} />
        </div>
      </div>

      {/* order entry */}
      <div className="border-b border-graphite px-4 py-3">
        {canBracket && (
          <div className="mb-3 rounded-images bg-cobalt/10 px-3 py-2">
            <p className="flex items-center gap-1.5 text-caption text-cobalt">
              <TrendingUp className="h-3.5 w-3.5" strokeWidth={1.5} /> Committee ruling: BUY {ticker}
            </p>
            <p className="mono mt-1 text-[11px] text-ash">
              target {usd(verdict!.priceTarget)} · stop {usd(verdict!.stop)} · max{" "}
              {verdict!.maxAllocationPct}%
            </p>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            inputMode="numeric"
            value={shares}
            onChange={(e) => setShares(e.target.value.replace(/[^0-9.]/g, ""))}
            className="w-16 rounded-input border border-graphite bg-obsidian px-3 py-2 text-center text-body-sm text-bone outline-none focus:border-cobalt"
            aria-label="Shares"
          />
          <span className="text-caption text-mute">
            sh · {last > 0 ? usd(last) : "—"}
          </span>
          <span className="mono ml-auto text-body-sm text-ash">
            {last > 0 ? usd(last * Number(shares || 0)) : "—"}
          </span>
        </div>
        <div className="mt-2.5 flex gap-2">
          <button
            disabled={busy || !(Number(shares) > 0)}
            onClick={() =>
              submit(
                canBracket
                  ? {
                      symbol: ticker,
                      side: "buy",
                      qty: Number(shares),
                      stopLoss: verdict!.stop,
                      takeProfit: verdict!.priceTarget,
                    }
                  : { symbol: ticker, side: "buy", qty: Number(shares) },
                canBracket ? "Bracket buy" : "Buy",
              )
            }
            className="flex-1 rounded-pill bg-cobalt py-2 text-body-sm font-medium text-pure-white transition-colors hover:bg-cobalt-hover disabled:opacity-40"
          >
            {canBracket ? "Execute ruling" : "Buy"}
          </button>
          <button
            disabled={busy || !(Number(shares) > 0)}
            onClick={() => submit({ symbol: ticker, side: "sell", qty: Number(shares) }, "Sell")}
            className="flex-1 rounded-pill border border-bone/70 py-2 text-body-sm font-medium text-bone transition-colors hover:bg-bone/10 disabled:opacity-40"
          >
            Sell
          </button>
        </div>
        {msg && (
          <p
            className={cn(
              "mt-2 text-caption",
              msg.kind === "ok" ? "text-bull" : "text-bear",
            )}
          >
            {msg.text}
          </p>
        )}
        {error && !msg && <p className="mt-2 text-caption text-bear">{error}</p>}
      </div>

      {/* positions */}
      <div className="px-4 py-3">
        <p className="eyebrow mb-2">Positions</p>
        {positions.length === 0 ? (
          <p className="py-2 text-body-sm text-mute">No open positions.</p>
        ) : (
          <ul className="space-y-1.5">
            {positions.map((p) => {
              const upl = n(p.unrealized_pl);
              return (
                <li
                  key={p.symbol}
                  className="flex items-center justify-between gap-2 rounded-images bg-void/40 px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <p className="mono text-body-sm text-bone">
                      {p.symbol}{" "}
                      <span className="text-mute">×{n(p.qty)}</span>
                    </p>
                    <p className="mono text-[11px] text-mute">
                      @ {usd(n(p.avg_entry_price))} → {usd(n(p.current_price))}
                    </p>
                  </div>
                  <div className="text-right">
                    <Delta value={upl} className="text-body-sm">
                      {upl >= 0 ? "+" : ""}
                      {usd(upl)}
                    </Delta>
                    <p className="mono text-[11px]">
                      <Delta value={upl}>{pct(n(p.unrealized_plpc) * 100)}</Delta>
                    </p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => liquidate(p.symbol)}
                    title={`Close ${p.symbol}`}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-pill text-mute transition-colors hover:bg-obsidian hover:text-bone disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* recent orders */}
      {orders.length > 0 && (
        <div className="border-t border-graphite px-4 py-3">
          <p className="eyebrow mb-2">Recent orders</p>
          <ul className="space-y-1">
            {orders.slice(0, 6).map((o) => (
              <li key={o.id} className="flex items-center justify-between text-[11px]">
                <span className="mono text-ash">
                  <span className={o.side === "buy" ? "text-bull" : "text-bear"}>
                    {o.side.toUpperCase()}
                  </span>{" "}
                  {n(o.qty ?? o.filled_qty)} {o.symbol}
                </span>
                <span className="mono text-mute">{o.status.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-images bg-void/40 px-2.5 py-1.5">
      <p className="text-mute">{label}</p>
      <p className="mono mt-0.5 text-body-sm text-bone">{value}</p>
    </div>
  );
}
