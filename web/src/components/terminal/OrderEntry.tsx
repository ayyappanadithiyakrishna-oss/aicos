"use client";

import { useState } from "react";
import { ShieldCheck, AlertTriangle, Lock } from "lucide-react";
import type { Quote } from "@/lib/market";
import type { Decision } from "@/lib/committee";
import { usd } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { TradeConfirmModal, type OrderIntent } from "./TradeConfirmModal";

type OrderType = "market" | "limit" | "stop";

/* Order entry, gated on the committee.
   Rule 1 — no committee verdict for this ticker, no trade (panel locked).
   Rule 2 — execution always passes through the non-skippable confirm modal. */
export function OrderEntry({
  quote,
  verdict,
  referencePrice,
  accountNumber,
}: {
  quote: Quote;
  verdict?: Decision;
  referencePrice?: number;
  accountNumber: string;
}) {
  const [type, setType] = useState<OrderType>("market");
  const [qty, setQty] = useState("100");
  const [limit, setLimit] = useState(quote.last.toFixed(2));
  const [intent, setIntent] = useState<OrderIntent | null>(null);

  const shares = Number(qty) || 0;
  const price = type === "market" ? quote.last : Number(limit) || quote.last;
  const notional = shares * price;

  // --- committee gate ---
  const hasVerdict = !!verdict;
  const noBuy = !!verdict && (verdict.verdict === "SELL" || verdict.verdict === "REDUCE");
  const lowConf = !!verdict && verdict.confidence < 50;
  const sizedOk = shares > 0;

  const buyDisabled = !hasVerdict || noBuy || !sizedOk;
  const sellDisabled = !hasVerdict || !sizedOk;
  const buyLabel = !hasVerdict
    ? "Awaiting committee"
    : noBuy
      ? "Committee: No buy"
      : "Buy";
  const sellLabel = !hasVerdict ? "Awaiting committee" : "Sell";

  function open(side: "buy" | "sell") {
    setIntent({
      symbol: quote.ticker,
      side,
      orderType: type,
      quantity: shares,
      limitPrice: type === "limit" ? Number(limit) || undefined : undefined,
      stopPrice: type === "stop" ? Number(limit) || undefined : undefined,
    });
  }

  return (
    <div className="px-4 py-4">
      {/* order type */}
      <div className="flex gap-1">
        {(["market", "limit", "stop"] as OrderType[]).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={cn(
              "flex-1 rounded-images border py-1 text-caption capitalize transition-colors",
              type === t
                ? "border-frost text-bone"
                : "border-graphite text-ash hover:text-frost",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2.5">
        <Field label="Quantity">
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className="w-full bg-transparent text-right mono text-body-sm text-bone outline-none"
          />
        </Field>
        {type !== "market" && (
          <Field label={type === "limit" ? "Limit price" : "Stop price"}>
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              inputMode="decimal"
              className="w-full bg-transparent text-right mono text-body-sm text-bone outline-none"
            />
          </Field>
        )}
        <div className="flex items-center justify-between rounded-images bg-smoke/50 px-3 py-2">
          <span className="text-caption text-ash">Est. notional</span>
          <span className="mono text-body-sm text-bone">{usd(notional)}</span>
        </div>
      </div>

      {/* actions — committee-gated */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <button
            onClick={() => open("buy")}
            disabled={buyDisabled}
            className={cn(
              "w-full rounded-pill py-2.5 text-body-sm font-medium transition-colors",
              buyDisabled
                ? "cursor-not-allowed border border-graphite text-mute"
                : "bg-bone text-void hover:bg-frost",
            )}
          >
            {buyLabel}
          </button>
          {hasVerdict && !noBuy && lowConf && (
            <p className="mt-1 flex items-center justify-center gap-1 text-[10px] text-warn">
              <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
              Low conviction ({verdict!.confidence})
            </p>
          )}
        </div>
        <button
          onClick={() => open("sell")}
          disabled={sellDisabled}
          className={cn(
            "h-fit rounded-pill py-2.5 text-body-sm font-medium transition-colors",
            sellDisabled
              ? "cursor-not-allowed border border-graphite text-mute"
              : "border border-bear/50 text-bear hover:bg-bear/10",
          )}
        >
          {sellLabel}
        </button>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-mute">
        {hasVerdict ? (
          <>
            <ShieldCheck className="h-3 w-3" strokeWidth={1.5} />
            Committee ruling on {quote.ticker}: {verdict!.verdict} · confirm before capital moves
          </>
        ) : (
          <>
            <Lock className="h-3 w-3" strokeWidth={1.5} />
            Convene the committee on {quote.ticker} to unlock trading
          </>
        )}
      </p>

      {intent && verdict && (
        <TradeConfirmModal
          intent={intent}
          price={quote.last}
          referencePrice={referencePrice}
          verdict={verdict}
          accountNumber={accountNumber}
          onClose={() => setIntent(null)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between rounded-images border border-graphite px-3 py-2">
      <span className="text-caption text-ash">{label}</span>
      <span className="flex-1 pl-3">{children}</span>
    </label>
  );
}
