"use client";

import { motion } from "framer-motion";
import { AGENT_MAP, type AgentId, type AgentScore } from "@/lib/committee";
import { cn } from "@/lib/utils";

export function ScoreRail({
  scores,
  reveal,
  spoke,
}: {
  scores: AgentScore[];
  reveal: boolean;
  spoke: Set<AgentId>;
}) {
  return (
    <div className="rounded-cards border border-graphite bg-carbon/80 backdrop-blur-sm">
      <header className="border-b border-graphite px-4 py-2.5">
        <span className="eyebrow">Live Scorecard</span>
      </header>
      <ul className="divide-y divide-graphite">
        {scores.map((sc) => {
          const agent = AGENT_MAP[sc.agent];
          const shown = reveal || spoke.has(sc.agent);
          return (
            <li key={sc.agent} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-body-sm text-bone">{agent.name}</span>
                <span className="mono text-caption text-ash">{sc.label}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-smoke">
                <motion.div
                  className={cn(
                    "h-full rounded-pill",
                    agent.stance === "bull"
                      ? "bg-bull"
                      : agent.stance === "bear"
                        ? "bg-bear"
                        : "bg-frost",
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: shown ? `${sc.score}%` : 0 }}
                  transition={{ duration: 0.9, ease: "easeOut" }}
                />
              </div>
              {shown && (
                <motion.ul
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="mt-2 space-y-1"
                >
                  {sc.bullets.map((b) => (
                    <li key={b} className="flex gap-1.5 text-[11px] leading-snug text-ash">
                      <span className="text-mute">·</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </motion.ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
