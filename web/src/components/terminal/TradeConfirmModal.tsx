"use client";

import { useEffect, useState } from "react";
import { X, ShieldCheck } from "lucide-react";
import type { Decision } from "@/lib/committee";
import { usd } from "@/lib/utils";

const IRIDESCENT = "linear-gradient(135deg, #d1aad7 0%, #bbdef2 50%, #f4f0ff 100%)";
const ERROR = "#f0997b";
const DRIFT_WARN = "#EF9F27";

export interface OrderIntent {
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit" | "stop";
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
}

type Status = "idle" | "submitting" | "success" | "error";

export function TradeConfirmModal({
  intent,
  price,
  referencePrice,
  verdict,
  accountNumber,
  onClose,
}: {
  intent: OrderIntent;
  price: number;
  /** Spot price captured when the committee ruled — used for the drift check. */
  referencePrice?: number;
  verdict: Decision;
  accountNumber: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<{ orderId?: string; state?: string }>({});

  // Re-fetch a fresh quote when the modal opens — do NOT trust the price that
  // was in the quote panel when the user clicked Buy.
  const [freshPrice, setFreshPrice] = useState<number | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/quote?symbols=${encodeURIComponent(intent.symbol)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          quotes?: { last?: number; price?: number }[];
          asOf?: string;
        };
        if (cancelled) return;
        const q = data.quotes?.[0];
        const p = q?.price ?? q?.last;
        if (p && p > 0) setFreshPrice(p);
        setAsOf(data.asOf ? Date.parse(data.asOf) || Date.now() : Date.now());
      } catch {
        /* keep the passed-in price as a stopgap */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [intent.symbol]);

  const effectivePrice = freshPrice ?? price;
  const estValue = intent.quantity * effectivePrice;
  const driftPct =
    referencePrice && referencePrice > 0
      ? ((effectivePrice - referencePrice) / referencePrice) * 100
      : null;
  const last4 = accountNumber.slice(-4);
  const refPrice =
    intent.orderType === "limit"
      ? intent.limitPrice
      : intent.orderType === "stop"
        ? intent.stopPrice
        : undefined;

  async function confirm() {
    setStatus("submitting");
    setError("");
    try {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...intent, accountNumber, confirmed: true }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        orderId?: string;
        state?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error || "The order could not be placed.");
        setStatus("error");
        return;
      }
      setResult({ orderId: data.orderId, state: data.state });
      setStatus("success");
    } catch {
      setError("Network error — the order was not placed.");
      setStatus("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-void/85 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-cards bg-carbon p-8">
        <div className="flex items-start justify-between">
          <p className="eyebrow">Confirm order · committee-approved</p>
          <button onClick={onClose} className="text-ash hover:text-bone" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* headline */}
        <h2 className="display mt-3 text-display capitalize text-bone">
          {intent.side} {intent.symbol}
        </h2>

        {status === "success" ? (
          <Success orderId={result.orderId} state={result.state} onClose={onClose} />
        ) : (
          <>
            {/* spec grid */}
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
              <Spec k="Order type" v={intent.orderType} />
              <Spec k="Quantity" v={`${intent.quantity} sh`} />
              <Spec
                k="Est. value"
                v={usd(estValue)}
                sub={
                  refPrice
                    ? `@ ${usd(refPrice)}`
                    : `@ ${usd(effectivePrice)}${freshPrice ? "" : " mkt"}`
                }
              />
              <Spec k="Account" v={`Agentic ••••${last4}`} />
            </dl>

            {/* live price freshness + committee drift */}
            <p className="mono mt-2 text-[11px] text-ash">
              {asOf
                ? `Price as of ${new Date(asOf).toLocaleTimeString(undefined, { hour12: false })}`
                : "Fetching live price…"}
            </p>
            {driftPct != null && Math.abs(driftPct) > 2 && (
              <p className="mono mt-1 text-[11px]" style={{ color: DRIFT_WARN }}>
                Price moved {driftPct > 0 ? "+" : ""}
                {driftPct.toFixed(1)}% since committee analysis
              </p>
            )}

            {/* committee block */}
            <div className="mt-6 rounded-images border border-graphite bg-void/40 p-4">
              <p className="eyebrow text-lilac">Committee mandate</p>
              <dl className="mono mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] text-ash">
                <CRow k="Verdict" v={verdict.verdict} />
                <CRow k="Confidence" v={`${verdict.confidence}`} />
                <CRow k="Position size" v={`${verdict.maxAllocationPct}% of book`} />
                <CRow k="Stop" v={usd(verdict.stop)} />
              </dl>
              <p className="mono mt-3 border-t border-graphite pt-3 text-[13px] leading-relaxed text-ash">
                {verdict.thesis}
              </p>
            </div>

            {/* disclaimer */}
            <p className="mt-4 text-[11px] leading-relaxed text-ash">
              Orders are placed on your Robinhood brokerage account. AICOS does not
              hold funds. This is not investment advice.
            </p>

            {error && (
              <p
                className="mono mt-4 rounded-images border px-3 py-2 text-[13px]"
                style={{ color: ERROR, borderColor: `${ERROR}55` }}
              >
                {error}
              </p>
            )}

            {/* actions */}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                disabled={status === "submitting"}
                className="inline-flex items-center rounded-pill border border-ash/60 px-5 py-2 text-body-sm font-medium text-bone hover:bg-bone/5 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={confirm}
                disabled={status === "submitting"}
                style={{ background: IRIDESCENT }}
                className="inline-flex items-center gap-2 rounded-pill px-6 py-2 text-body-sm font-medium text-void transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {status === "submitting" ? "Placing order…" : "Confirm order"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Spec({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-mute">{k}</dt>
      <dd className="mono mt-1 text-body-sm capitalize text-bone">
        {v}
        {sub && <span className="ml-1.5 text-[11px] normal-case text-mute">{sub}</span>}
      </dd>
    </div>
  );
}

function CRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-mute">{k}</span>
      <span className="text-frost">{v}</span>
    </div>
  );
}

function Success({
  orderId,
  state,
  onClose,
}: {
  orderId?: string;
  state?: string;
  onClose: () => void;
}) {
  return (
    <div className="mt-6 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-pill border border-bull/40 text-bull">
        <ShieldCheck className="h-6 w-6" strokeWidth={1.5} />
      </div>
      <p className="mt-4 text-body text-bone">Order submitted to Robinhood</p>
      <dl className="mono mx-auto mt-4 max-w-xs space-y-2 text-[13px]">
        <div className="flex items-center justify-between">
          <span className="text-mute">Order ID</span>
          <span className="text-frost">{orderId ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-mute">State</span>
          <span className="text-bull">{state ?? "queued"}</span>
        </div>
      </dl>
      <button
        onClick={onClose}
        className="mt-6 w-full rounded-pill border border-ash/60 py-2.5 text-body-sm text-bone hover:bg-bone/5"
      >
        Done
      </button>
    </div>
  );
}
