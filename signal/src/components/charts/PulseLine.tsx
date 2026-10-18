import type { PriceBar } from "@/lib/domain/types";
import { signedPct, timeET } from "@/lib/format";

/**
 * Lightweight server-rendered session path vs prior close, with catalyst ticks at actual
 * publication times. Static SVG keeps Market Pulse fast; the ticker cockpit has the full chart.
 */
export function PulseLine({ bars, prevClose, markers }: { bars: PriceBar[]; prevClose: number | null; markers: Array<{ at: string; label: string }> }) {
  const W = 800;
  const H = 180;
  const pad = { l: 8, r: 52, t: 10, b: 22 };
  const base = prevClose ?? bars[0]!.o;
  const rets = bars.map((b) => (100 * (b.c - base)) / base);
  const lo = Math.min(0, ...rets);
  const hi = Math.max(0, ...rets);
  const span = Math.max(0.2, hi - lo);
  const t0 = Date.parse(bars[0]!.t) - 30 * 60000;
  // Full regular session on the x-axis so a partial session reads as partial.
  const t1 = t0 + 390 * 60000;
  const tLast = Date.parse(bars[bars.length - 1]!.t);
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((hi - v) / span) * (H - pad.t - pad.b);
  const pts = [[x(t0), y(0)] as const, ...bars.map((b, i) => [x(Date.parse(b.t)), y(rets[i]!)] as const)];
  const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const last = rets[rets.length - 1]!;
  const color = last >= 0 ? "var(--pos)" : "var(--neg)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Session path: ${signedPct(last, { dp: 2 })} vs prior close at ${timeET(bars[bars.length - 1]!.t)}`}>
      <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--line-2)" strokeDasharray="3 3" />
      <text x={W - pad.r + 6} y={y(0) + 3} fontSize={10} fill="var(--ink-3)" fontFamily="var(--ff-mono)">
        0.00%
      </text>
      <path d={`${d} L${pts[pts.length - 1]![0].toFixed(1)},${y(0).toFixed(1)} L${pts[0]![0].toFixed(1)},${y(0).toFixed(1)} Z`} fill={color} opacity={0.08} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} />
      <text x={W - pad.r + 6} y={y(last) + 3} fontSize={10.5} fill={color} fontFamily="var(--ff-mono)">
        {signedPct(last, { dp: 2 })}
      </text>
      {markers
        .filter((m) => Date.parse(m.at) >= t0 && Date.parse(m.at) <= tLast)
        .map((m, i) => {
          const mx = x(Date.parse(m.at));
          return (
            <g key={i}>
              <line x1={mx} x2={mx} y1={pad.t} y2={H - pad.b} stroke="var(--accent)" strokeOpacity={0.45} />
              <circle cx={mx} cy={H - pad.b} r={3} fill="var(--accent)">
                <title>{`${timeET(m.at)} · ${m.label}`}</title>
              </circle>
            </g>
          );
        })}
      {[
        ["09:30", 0, "start"],
        ["12:00", 150, "middle"],
        ["14:00", 270, "middle"],
        ["16:00", 390, "end"],
      ].map(([lab, min, anchor]) => (
        <text key={lab as string} x={x(t0 + (min as number) * 60000)} y={H - 6} fontSize={10} fill="var(--ink-3)" fontFamily="var(--ff-mono)" textAnchor={anchor as "start" | "middle" | "end"}>
          {lab}
        </text>
      ))}
    </svg>
  );
}
