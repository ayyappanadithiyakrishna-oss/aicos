import type { Direction } from "@/lib/domain/types";
import { signedPct } from "@/lib/format";

/**
 * SIGNAL's signature: an honest uncertainty strip. The 80% interval is drawn against a zero line,
 * the portion above zero tinted green and below tinted coral, so an interval that crosses zero is
 * visibly two-sided. The neutral band ("no material move") is a faint zone around zero; the central
 * estimate is a tick colored by the model's direction. Abstentions render a hatched empty track.
 */
export function IntervalBar({
  central,
  lo,
  hi,
  band,
  direction,
  width = 76,
  height = 14,
  scale,
  label,
}: {
  central: number | null;
  lo: number | null;
  hi: number | null;
  band: number | null;
  direction: Direction;
  width?: number;
  height?: number;
  /** Symmetric half-range in percent; defaults to fit the interval. */
  scale?: number;
  label?: string;
}) {
  const hasInterval = lo !== null && hi !== null;
  const half = Math.max(scale ?? 0, Math.abs(lo ?? 0), Math.abs(hi ?? 0), Math.abs(central ?? 0), (band ?? 0) * 2, 0.5) * 1.08;
  const x = (v: number) => ((v + half) / (2 * half)) * width;
  const mid = x(0);
  const y = height / 2;
  const desc = hasInterval
    ? `${label ? `${label}: ` : ""}80% interval ${signedPct(lo)} to ${signedPct(hi)}${central !== null ? `, central ${signedPct(central)}` : ", central estimate suppressed"}${lo! < 0 && hi! > 0 ? " (interval crosses zero)" : ""}`
    : `${label ? `${label}: ` : ""}no calibrated interval available`;
  const tickColor = direction === "bullish" ? "var(--pos)" : direction === "bearish" ? "var(--neg)" : "var(--ink-2)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={desc} className="shrink-0 overflow-visible">
      <title>{desc}</title>
      {hasInterval ? (
        <rect x={0} y={y - 1.5} width={width} height={3} rx={1.5} fill="var(--surface-3)" />
      ) : (
        <line x1={0} x2={width} y1={y} y2={y} stroke="var(--line-2)" strokeWidth={3} strokeDasharray="2 3" />
      )}
      {band ? <rect x={x(-band)} y={y - 4} width={Math.max(1, x(band) - x(-band))} height={8} rx={1} fill="var(--line-2)" opacity={0.55} /> : null}
      {hasInterval ? (
        <>
          {lo! < 0 ? <rect x={x(lo!)} y={y - 3} width={Math.max(0.5, Math.min(mid, x(hi!)) - x(lo!))} height={6} rx={1.5} fill="var(--neg)" opacity={0.42} /> : null}
          {hi! > 0 ? <rect x={Math.max(mid, x(lo!))} y={y - 3} width={Math.max(0.5, x(hi!) - Math.max(mid, x(lo!)))} height={6} rx={1.5} fill="var(--pos)" opacity={0.42} /> : null}
        </>
      ) : null}
      <line x1={mid} x2={mid} y1={0.5} y2={height - 0.5} stroke="var(--ink-3)" strokeWidth={1} />
      {central !== null ? <rect x={x(central) - 1.25} y={1} width={2.5} height={height - 2} rx={1} fill={tickColor} /> : null}
    </svg>
  );
}
