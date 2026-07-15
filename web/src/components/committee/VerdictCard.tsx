import { Gavel, Target, ShieldAlert, Percent } from "lucide-react";
import type { Decision, Verdict } from "@/lib/committee";
import { usd } from "@/lib/utils";
import { cn } from "@/lib/utils";

const verdictTone: Record<Verdict, string> = {
  BUY: "text-bull border-bull/40",
  WATCHLIST: "text-lilac border-lilac/30",
  SPECULATIVE: "text-warn border-warn/40",
  REDUCE: "text-warn border-warn/40",
  SELL: "text-bear border-bear/40",
};

export function VerdictCard({ decision }: { decision: Decision }) {
  return (
    <div className="rounded-cards border border-graphite bg-smoke/60 p-6">
      <div className="flex items-center gap-2 text-lilac">
        <Gavel className="h-4 w-4" strokeWidth={1.5} />
        <span className="eyebrow text-lilac">Chair&apos;s Ruling</span>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p
            className={cn(
              "display inline-flex items-center rounded-pill border px-4 py-1.5 text-heading-lg",
              verdictTone[decision.verdict],
            )}
          >
            {decision.verdict}
          </p>
          <p className="mt-2 text-caption text-ash">
            {decision.ticker} · {decision.company}
          </p>
        </div>
        <div className="text-right">
          <p className="mono text-display text-bone leading-none">
            {decision.confidence}
          </p>
          <p className="eyebrow mt-1">Confidence</p>
        </div>
      </div>

      <p className="mt-5 text-body-sm leading-relaxed text-frost/90">
        {decision.thesis}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<Target className="h-3.5 w-3.5" />} label="Price target" value={usd(decision.priceTarget)} />
        <Stat icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Stop" value={usd(decision.stop)} />
        <Stat icon={<Percent className="h-3.5 w-3.5" />} label="Max alloc" value={`${decision.maxAllocationPct}%`} />
        <Stat icon={<Gavel className="h-3.5 w-3.5" />} label="Mandate" value={mandate(decision.verdict)} />
      </div>

      <div className="mt-6 border-t border-graphite pt-4">
        <p className="eyebrow">Kill conditions</p>
        <ul className="mt-2 space-y-1.5">
          {decision.killConditions.map((k) => (
            <li key={k} className="flex gap-2 text-caption text-ash">
              <span className="text-bear">×</span>
              <span>{k}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function mandate(v: Verdict) {
  return v === "BUY" || v === "SPECULATIVE"
    ? "Initiate"
    : v === "WATCHLIST"
      ? "Stage"
      : v === "REDUCE"
        ? "Trim"
        : "Exit";
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-images border border-graphite bg-carbon/60 p-3">
      <div className="flex items-center gap-1.5 text-mute">{icon}</div>
      <p className="mono mt-1.5 text-body-sm text-bone">{value}</p>
      <p className="mt-0.5 text-[11px] text-ash">{label}</p>
    </div>
  );
}
