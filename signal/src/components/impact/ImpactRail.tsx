"use client";
import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import clsx from "clsx";
import { ArrowUpRight } from "lucide-react";
import type { Horizon } from "@/lib/domain/types";
import type { CardExposure, CardForecast } from "@/lib/data/cards";
import { DIRECTION_LABEL, DIRECTION_SHORT, DIRECTION_TONE, HORIZON_LONG, RELATIONSHIP_LABEL, REASON_SHORT, TIER_LABEL, pct, signedPct } from "@/lib/format";
import { Monogram } from "@/components/ui/SecurityMark";
import { toneText } from "@/components/ui/primitives";
import { IntervalBar } from "./IntervalBar";

export function ForecastFigure({ f, className }: { f: CardForecast | undefined; className?: string }) {
  if (!f) return <span className={clsx("text-ink-3", className)}>—</span>;
  if (f.tier === "insufficient") return <span className={clsx("text-ink-3", className)}>Insufficient data</span>;
  if (f.central === null) {
    if (f.tier === "direction_only") return <span className={clsx("text-ink-3", className)}>Direction only</span>;
    return <span className={clsx("text-ink-3", className)} title="Central estimate suppressed (within normal volatility)">≈ noise</span>;
  }
  return <span className={clsx("num font-mono", f.central > 0 ? "text-pos" : f.central < 0 ? "text-neg" : "text-ink-2", className)}>{signedPct(f.central)}</span>;
}

function WhyPopover({ x, horizon, children }: { x: CardExposure; horizon: Horizon; children: React.ReactNode }) {
  const f = x.forecasts[horizon];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} collisionPadding={12} className="fade-in w-[min(380px,calc(100vw-24px))] rounded-lg border border-line-2 bg-surface p-3.5 text-sm shadow-xl" style={{ zIndex: "var(--z-dropdown)" }}>
          <div className="flex items-start gap-2.5">
            <Monogram ticker={x.ticker} size={28} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-semibold text-ink">{x.ticker}</span>
                <span className="rounded-sm bg-surface-3 px-1 font-mono text-[10px] uppercase text-ink-2">{x.directness === "direct" ? "Direct" : "Second-order"}</span>
              </div>
              <div className="truncate text-xs text-ink-3">{x.name}</div>
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xs font-medium text-ink-3">Why this ticker?</div>
            <ol className="mt-1.5 space-y-1 border-l border-line-2 pl-3">
              {x.linkage.map((l, i) => (
                <li key={i} className="relative text-xs text-ink-2 before:absolute before:-left-[15px] before:top-1.5 before:size-1.5 before:rounded-full before:bg-line-2">
                  {l}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-ink-2">
              <span className="text-ink-3">{RELATIONSHIP_LABEL[x.relationship]}:</span> {x.mechanism}
            </p>
          </div>
          <div className="mt-3 rounded-md border border-line bg-surface-2 p-2.5">
            <div className="flex items-center justify-between text-2xs text-ink-3">
              <span>Model view · {HORIZON_LONG[horizon]} · abnormal return</span>
              {f ? <span>{f.modelVersion}</span> : null}
            </div>
            {f ? (
              <>
                <div className="mt-1.5 flex items-center gap-3">
                  <span className={clsx("text-sm font-medium", toneText[DIRECTION_TONE[f.direction]])}>{DIRECTION_LABEL[f.direction]}</span>
                  <ForecastFigure f={f} className="text-sm" />
                  <IntervalBar central={f.central} lo={f.lo} hi={f.hi} band={f.band} direction={f.direction} width={96} label={x.ticker} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
                  <dt className="text-ink-3">80% interval</dt>
                  <dd className="num text-right font-mono text-ink-2">{f.lo !== null ? `${signedPct(f.lo)} … ${signedPct(f.hi)}` : "Not available"}</dd>
                  <dt className="text-ink-3">P(up / down / none)</dt>
                  <dd className="num text-right font-mono text-ink-2">{f.probs ? `${pct(f.probs.up)} / ${pct(f.probs.down)} / ${pct(f.probs.neutral)}` : "Withheld"}</dd>
                  <dt className="text-ink-3">Neutral band</dt>
                  <dd className="num text-right font-mono text-ink-2">{f.band !== null ? `±${f.band}%` : "—"}</dd>
                  <dt className="text-ink-3">Comparable events</dt>
                  <dd className="num text-right font-mono text-ink-2">{f.nEff || "—"}</dd>
                  <dt className="text-ink-3">Quality</dt>
                  <dd className="text-right text-ink-2">{TIER_LABEL[f.tier]}</dd>
                  {f.realized ? (
                    <>
                      <dt className="text-ink-3">Observed (resolved)</dt>
                      <dd className="num text-right font-mono text-ink">{f.realized.status === "resolved" ? signedPct(f.realized.ar) : f.realized.status.replace("_", " ")}</dd>
                    </>
                  ) : null}
                </dl>
                {f.reasonText.length ? (
                  <ul className="mt-2 space-y-0.5 text-2xs text-ink-3">
                    {f.reasonText.map((r) => (
                      <li key={r}>· {r}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-xs text-ink-3">No forecast for this horizon.</p>
            )}
          </div>
          {x.evidence.length ? (
            <div className="mt-3">
              <div className="text-2xs font-medium text-ink-3">Evidence</div>
              <ul className="mt-1 space-y-1">
                {x.evidence.slice(0, 3).map((e) => (
                  <li key={e.id} className="text-xs">
                    <a href={e.href} target={e.external ? "_blank" : undefined} rel={e.external ? "noopener noreferrer nofollow" : undefined} className="inline-flex items-center gap-1 text-accent hover:underline">
                      {e.label}
                      {e.external ? <ArrowUpRight className="size-3" aria-hidden /> : null}
                    </a>
                    <span className="ml-1 text-ink-3">· {e.kind}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Link href={`/ticker/${x.ticker}`} className="mt-3 inline-flex items-center gap-1 text-xs text-accent hover:underline">
            Open {x.ticker} cockpit <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function TickerChip({ x, horizon, scale }: { x: CardExposure; horizon: Horizon; scale: number }) {
  const f = x.forecasts[horizon];
  const dir = f?.direction ?? "insufficient";
  return (
    <WhyPopover x={x} horizon={horizon}>
      <button
        type="button"
        className="group flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-line bg-surface-2 py-1.5 pl-1.5 pr-2.5 text-left transition-colors duration-150 hover:border-line-2 hover:bg-surface-3"
        aria-label={`${x.ticker}: ${DIRECTION_LABEL[dir]}${f?.central !== null && f?.central !== undefined ? `, model estimate ${signedPct(f.central)}` : ""}. Why this ticker?`}
      >
        <Monogram ticker={x.ticker} size={22} />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-xs font-semibold text-ink">{x.ticker}</span>
            <span className={clsx("text-2xs font-medium", toneText[DIRECTION_TONE[dir]])}>{DIRECTION_SHORT[dir]}</span>
          </span>
          <span className="flex items-center gap-1.5 text-2xs">
            <ForecastFigure f={f} />
            {f?.probs ? <span className="num font-mono text-ink-3">P↑{pct(f.probs.up)}</span> : null}
          </span>
        </span>
        <IntervalBar central={f?.central ?? null} lo={f?.lo ?? null} hi={f?.hi ?? null} band={f?.band ?? null} direction={dir} width={58} scale={scale} label={x.ticker} />
      </button>
    </WhyPopover>
  );
}

export function ImpactRail({ exposures, horizon, max = 4 }: { exposures: CardExposure[]; horizon: Horizon; max?: number }) {
  if (!exposures.length) {
    return <p className="text-xs text-ink-3">No defensible exposure identified — no ticker is forced onto this event.</p>;
  }
  const shown = exposures.slice(0, max);
  const extra = exposures.length - shown.length;
  const scale = Math.max(1, ...shown.flatMap((x) => [Math.abs(x.forecasts[horizon]?.lo ?? 0), Math.abs(x.forecasts[horizon]?.hi ?? 0)]));
  const direct = shown.filter((x) => x.directness === "direct");
  const second = shown.filter((x) => x.directness === "second_order");
  return (
    <div className="flex flex-wrap items-stretch gap-x-3 gap-y-2">
      {[["Direct", direct] as const, ["Second-order", second] as const].map(([label, xs]) =>
        xs.length ? (
          <div key={label} className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="w-full font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3 sm:w-auto sm:pr-1">{label}</span>
            {xs.map((x) => (
              <TickerChip key={x.securityId} x={x} horizon={horizon} scale={scale} />
            ))}
          </div>
        ) : null,
      )}
      {extra > 0 ? <span className="self-center font-mono text-2xs text-ink-3">+{extra} supported</span> : null}
    </div>
  );
}

export { REASON_SHORT };
