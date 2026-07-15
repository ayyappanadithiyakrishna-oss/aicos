import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/* The single button shape in the system: a ghost pill. */
export function Pill({
  children,
  href,
  onClick,
  variant = "ghost",
  className,
  arrow = false,
  type = "button",
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: "ghost" | "solid";
  className?: string;
  arrow?: boolean;
  type?: "button" | "submit";
}) {
  const base = cn(
    "inline-flex items-center gap-2 rounded-pill px-5 py-2 text-body-sm font-medium transition-colors duration-200 select-none",
    variant === "ghost"
      ? "border border-ash/60 text-bone hover:border-bone hover:bg-bone/5"
      : "bg-bone text-void hover:bg-frost",
    className,
  );
  const inner = (
    <>
      {children}
      {arrow && <ArrowRight className="h-4 w-4" strokeWidth={1.5} />}
    </>
  );
  if (href)
    return (
      <Link href={href} className={base}>
        {inner}
      </Link>
    );
  return (
    <button type={type} onClick={onClick} className={base}>
      {inner}
    </button>
  );
}

export function TextLink({
  children,
  href,
  className,
}: {
  children: React.ReactNode;
  href: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 text-body-sm font-medium text-bone hover:text-lilac transition-colors",
        className,
      )}
    >
      {children}
      <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
    </Link>
  );
}

export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={cn("eyebrow", className)}>{children}</p>;
}

/* Terminal panel — Carbon surface, hairline border, optional title rail. */
export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-cards border border-graphite bg-carbon/80 backdrop-blur-sm overflow-hidden",
        className,
      )}
    >
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-graphite px-4 py-2.5">
          <span className="eyebrow">{title}</span>
          {action}
        </header>
      )}
      <div className={cn("flex-1 min-h-0", bodyClassName)}>{children}</div>
    </section>
  );
}

/* Signed value with bull/bear tint. */
export function Delta({
  value,
  children,
  className,
}: {
  value: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "mono tabular-nums",
        value > 0 ? "text-bull" : value < 0 ? "text-bear" : "text-ash",
        className,
      )}
    >
      {children}
    </span>
  );
}
