import clsx from "clsx";

/**
 * Logo slot. Real logos render only when branding rights are licensed AND a logo URL exists;
 * otherwise a color-coded monogram with the ticker text — never a broken image.
 */
const HUES = [196, 214, 168, 262, 32, 340, 140, 288];

function hueFor(ticker: string): number {
  let h = 0;
  for (let i = 0; i < ticker.length; i++) h = (h * 31 + ticker.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length]!;
}

export function Monogram({ ticker, size = 20, className }: { ticker: string; size?: number; className?: string }) {
  const hue = hueFor(ticker);
  const letters = ticker.replace(/[^A-Z]/gi, "").slice(0, ticker.length > 3 ? 2 : 1).toUpperCase();
  return (
    <span
      aria-hidden="true"
      data-testid="monogram"
      className={clsx("monogram inline-flex shrink-0 items-center justify-center rounded-[5px] font-mono font-semibold", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44), ["--mono-h" as string]: hue }}
    >
      {letters}
    </span>
  );
}

export function SecurityMark({ ticker, logoUrl, brandingRights = "none", size = 20 }: { ticker: string; logoUrl?: string | null; brandingRights?: "none" | "licensed"; size?: number }) {
  if (brandingRights === "licensed" && logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- licensed vendor logo URL; next/image domains vary per vendor
    return <img src={logoUrl} alt="" width={size} height={size} className="shrink-0 rounded-[5px]" data-testid="logo" />;
  }
  return <Monogram ticker={ticker} size={size} />;
}
