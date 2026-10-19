import type { ReactNode } from "react";
import clsx from "clsx";
import type { Direction } from "@/lib/domain/types";
import { DIRECTION_LABEL, DIRECTION_SHORT, DIRECTION_TONE, signedPct } from "@/lib/format";

export const toneText = { pos: "text-pos", neg: "text-neg", muted: "text-ink-3", warn: "text-warn", accent: "text-accent", ink: "text-ink" } as const;
export const toneBg = { pos: "bg-pos-dim text-pos", neg: "bg-neg-dim text-neg", muted: "bg-surface-3 text-ink-2", warn: "bg-warn-dim text-warn", accent: "bg-accent-dim text-accent", ink: "bg-surface-3 text-ink" } as const;

export function Chip({ children, tone = "muted", className, title }: { children: ReactNode; tone?: keyof typeof toneBg; className?: string; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium whitespace-nowrap", toneBg[tone], className)}>
      {children}
    </span>
  );
}

export function DemoChip({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full bg-warn-dim px-2 py-0.5 text-2xs font-medium text-warn", className)} title="Synthetic demo data — not a real company, price or release">
      Demo
    </span>
  );
}

export function DirectionText({ direction, short, className }: { direction: Direction; short?: boolean; className?: string }) {
  return <span className={clsx("font-medium", toneText[DIRECTION_TONE[direction]], className)}>{short ? DIRECTION_SHORT[direction] : DIRECTION_LABEL[direction]}</span>;
}

export function Pct({ value, className, colored = true, dp }: { value: number | null | undefined; className?: string; colored?: boolean; dp?: number }) {
  const tone = value === null || value === undefined || !colored ? "text-ink-2" : value > 0 ? "text-pos" : value < 0 ? "text-neg" : "text-ink-2";
  return <span className={clsx("num font-mono", tone, className)}>{signedPct(value, { dp })}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-current/20 px-1 text-2xs opacity-70">{children}</kbd>;
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 id={id} className="text-[15px] font-semibold text-ink">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function Panel({ children, className, as: As = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" | "aside"; "aria-labelledby"?: string }) {
  return (
    <As className={clsx("min-w-0 rounded-lg bg-surface", className)} {...rest}>
      {children}
    </As>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-2 px-5 py-8 text-center">
      <p className="text-md font-medium text-ink">{title}</p>
      <div className="mx-auto mt-1 max-w-[52ch] text-sm text-ink-2">{body}</div>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="display text-ink">{title}</h1>
        {description ? <div className="mt-1 max-w-[75ch] text-sm text-ink-2">{description}</div> : null}
      </div>
      {children ? <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

export function Stat({ label, value, sub, tone = "ink" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: keyof typeof toneText }) {
  return (
    <div className="min-w-0">
      <div className="text-2xs text-ink-3">{label}</div>
      <div className={clsx("num mt-0.5 font-mono text-md", toneText[tone])}>{value}</div>
      {sub ? <div className="mt-0.5 text-2xs text-ink-3">{sub}</div> : null}
    </div>
  );
}

export const buttonClass = (variant: "primary" | "ghost" | "outline" = "outline", size: "sm" | "md" = "sm") =>
  clsx(
    "press inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "h-8 rounded-full px-3.5 text-sm" : "h-9 rounded-full px-5 text-base",
    variant === "primary" && "bg-accent text-accent-ink hover:bg-accent-strong",
    variant === "outline" && "bg-surface-3 text-ink hover:bg-line-2",
    variant === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink",
  );
