"use client";
import { useState } from "react";
import clsx from "clsx";
import { LOGO_TICKERS } from "@/lib/live/logoTickers";

const HUES = [196, 214, 168, 262, 32, 340, 140, 288];

function hueFor(ticker: string): number {
  let h = 0;
  for (let i = 0; i < ticker.length; i++) h = (h * 31 + ticker.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length]!;
}

/**
 * Company mark: the real logo for covered large caps (served same-origin from /api/logo),
 * otherwise a color-coded monogram. A logo that fails to load falls back to the monogram.
 */
export function Monogram({ ticker, size = 20, className }: { ticker: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const t = ticker.toUpperCase();
  const radius = Math.max(5, Math.round(size * 0.24));
  if (!failed && LOGO_TICKERS.has(t)) {
    return (
      <span
        aria-hidden="true"
        data-testid="logo"
        className={clsx("inline-flex shrink-0 items-center justify-center overflow-hidden bg-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.12)]", className)}
        style={{ width: size, height: size, borderRadius: radius }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- small same-origin logo; next/image adds nothing here */}
        <img src={`/api/logo/${encodeURIComponent(t)}`} alt="" width={size} height={size} loading="lazy" decoding="async" className="size-full object-contain p-[8%]" onError={() => setFailed(true)} />
      </span>
    );
  }
  const letters = t.replace(/[^A-Z]/g, "").slice(0, t.length > 3 ? 2 : 1);
  return (
    <span
      aria-hidden="true"
      data-testid="monogram"
      className={clsx("monogram inline-flex shrink-0 items-center justify-center font-semibold", className)}
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.42), ["--mono-h" as string]: hueFor(t) }}
    >
      {letters}
    </span>
  );
}
