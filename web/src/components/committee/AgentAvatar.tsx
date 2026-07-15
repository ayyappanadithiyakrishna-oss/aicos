import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/committee";

const stanceRing: Record<Agent["stance"], string> = {
  bull: "text-bull",
  bear: "text-bear",
  neutral: "text-ash",
};

export function AgentAvatar({
  agent,
  size = "md",
  active = false,
  className,
}: {
  agent: Agent;
  size?: "sm" | "md" | "lg";
  active?: boolean;
  className?: string;
}) {
  const dim =
    size === "lg" ? "h-12 w-12 text-body-sm" : size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-caption";
  return (
    <div
      className={cn(
        "relative grid place-items-center rounded-pill border bg-smoke font-medium tracking-wide shrink-0 transition-colors",
        active ? "border-bone text-bone" : "border-graphite text-frost",
        dim,
        className,
      )}
    >
      {agent.initials}
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-pill border-2 border-carbon",
          "bg-current",
          stanceRing[agent.stance],
          active && "breathe",
        )}
        aria-hidden
      />
    </div>
  );
}
