import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, dedupe Tailwind conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number as USD currency. */
export function usd(n: number, opts: Intl.NumberFormatOptions = {}) {
  const max = opts.maximumFractionDigits ?? 2;
  const min = opts.minimumFractionDigits ?? Math.min(2, max);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    ...opts,
  }).format(n);
}

/** Format a signed percentage, e.g. +1.24% */
export function pct(n: number, digits = 2) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

/** Compact large numbers: 1.2M, 3.4B */
export function compact(n: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}
