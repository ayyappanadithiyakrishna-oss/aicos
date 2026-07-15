"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { RotateCcw, Gavel, Quote } from "lucide-react";
import {
  AGENT_MAP,
  AGENTS,
  type AgentId,
  type AgentScore,
  type DebateLine,
  type Decision,
} from "@/lib/committee";
import { AgentAvatar } from "./AgentAvatar";
import { VerdictCard } from "./VerdictCard";
import { ScoreRail } from "./ScoreRail";
import { cn } from "@/lib/utils";

const WORD_MS = 36; // typing cadence
const GAP_MS = 360; // pause between speakers

type Status = "idle" | "thinking" | "speaking" | "spoke";
type Phase = "connecting" | "streaming" | "done" | "error";

const kindLabel: Record<DebateLine["kind"], string> = {
  statement: "",
  challenge: "challenges",
  concession: "concedes to",
  evidence: "submits evidence",
  ruling: "rules",
};

export function CommitteeRoom({
  ticker,
  onDecision,
}: {
  ticker: string;
  onDecision?: (decision: Decision) => void;
}) {
  const onDecisionRef = useRef(onDecision);
  onDecisionRef.current = onDecision;

  const [done, setDone] = useState<DebateLine[]>([]);
  const [partial, setPartial] = useState("");
  const [current, setCurrent] = useState<DebateLine | null>(null);
  const [scores, setScores] = useState<AgentScore[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [live, setLive] = useState(false);
  const [runId, setRunId] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const queue: DebateLine[] = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let typing = false;
    let streamDone = false;
    let cancelled = false;

    // reset view
    setDone([]);
    setPartial("");
    setCurrent(null);
    setScores([]);
    setDecision(null);
    setPhase("connecting");
    setLive(false);

    const finalizeIfReady = () => {
      if (streamDone && !typing && queue.length === 0) setPhase("done");
    };

    const pump = () => {
      if (typing || cancelled) return;
      const next = queue.shift();
      if (!next) {
        finalizeIfReady();
        return;
      }
      typing = true;
      setCurrent(next);
      const words = next.text.split(" ");
      let w = 0;
      const step = () => {
        if (cancelled) return;
        w += 1;
        setPartial(words.slice(0, w).join(" "));
        if (w < words.length) {
          timers.add(setTimeout(step, WORD_MS));
        } else {
          timers.add(
            setTimeout(() => {
              if (cancelled) return;
              setDone((d) => [...d, next]);
              setPartial("");
              setCurrent(null);
              typing = false;
              pump();
            }, GAP_MS),
          );
        }
      };
      timers.add(setTimeout(step, 160));
    };

    const es = new EventSource(
      `/api/committee?ticker=${encodeURIComponent(ticker)}`,
    );

    es.addEventListener("meta", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setLive(Boolean(d.live));
      setPhase("streaming");
    });
    es.addEventListener("line", (e) => {
      queue.push(JSON.parse((e as MessageEvent).data));
      pump();
    });
    es.addEventListener("scores", (e) =>
      setScores(JSON.parse((e as MessageEvent).data)),
    );
    es.addEventListener("decision", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as Decision;
      setDecision(d);
      onDecisionRef.current?.(d); // lift the ruling so order entry can unlock
    });
    es.addEventListener("done", () => {
      streamDone = true;
      es.close();
      finalizeIfReady();
    });
    es.addEventListener("error", () => {
      // server-sent error event
      es.close();
      if (!streamDone) setPhase("error");
    });
    es.onerror = () => {
      es.close();
      if (!streamDone && queue.length === 0 && !typing) setPhase("error");
    };

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      es.close();
    };
  }, [ticker, runId]);

  // autoscroll
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [done, partial, phase]);

  const spokeSet = useMemo(() => new Set(done.map((l) => l.agent)), [done]);
  const finished = phase === "done";

  function statusOf(id: AgentId): Status {
    if (current?.agent === id) return "speaking";
    if (spokeSet.has(id)) return "spoke";
    return phase === "connecting" ? "idle" : "thinking";
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr_300px]">
      {/* Roster */}
      <aside className="order-2 lg:order-1">
        <div className="rounded-cards border border-graphite bg-carbon/80 backdrop-blur-sm">
          <header className="flex items-center justify-between border-b border-graphite px-4 py-2.5">
            <span className="eyebrow">The Committee</span>
            <span className="mono text-[10px] text-mute">
              {spokeSet.size}/{AGENTS.length - 1}
            </span>
          </header>
          <ul className="divide-y divide-graphite">
            {AGENTS.map((a) => {
              const st = statusOf(a.id);
              return (
                <li
                  key={a.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 transition-opacity",
                    st === "idle" && "opacity-50",
                  )}
                >
                  <AgentAvatar agent={a} active={st === "speaking"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm text-bone">{a.name}</p>
                    <p className="truncate text-caption text-ash">{a.role}</p>
                  </div>
                  <StatusDot status={st} />
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      {/* Transcript */}
      <div className="order-1 lg:order-2 flex flex-col rounded-cards border border-graphite bg-carbon/60 backdrop-blur-sm min-h-[520px]">
        <header className="flex items-center justify-between border-b border-graphite px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "h-2 w-2 rounded-pill",
                phase === "error"
                  ? "bg-bear"
                  : finished
                    ? "bg-ash"
                    : "bg-bull breathe",
              )}
            />
            <span className="eyebrow">
              {phase === "connecting"
                ? "Convening committee"
                : phase === "error"
                  ? "Connection lost"
                  : finished
                    ? "Session adjourned"
                    : "Committee in session"}
            </span>
            <span
              className={cn(
                "mono rounded-pill border px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
                live
                  ? "border-bull/40 text-bull"
                  : "border-graphite text-mute",
              )}
              title={
                live
                  ? "Generated live by Claude (claude-opus-4-8)"
                  : "Deterministic simulation — add ANTHROPIC_API_KEY to go live"
              }
            >
              {live ? "Live AI" : "Sim"}
            </span>
          </div>
          <button
            onClick={() => setRunId((n) => n + 1)}
            className="inline-flex items-center gap-1.5 text-caption text-ash hover:text-bone transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
            Replay
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {phase === "connecting" && (
            <p className="text-body-sm text-ash">
              Assembling the committee on {ticker}…
            </p>
          )}
          {done.map((line) => (
            <Line key={line.id} line={line} />
          ))}
          {current && partial && <Line line={current} text={partial} live />}

          {phase === "error" && (
            <p className="text-body-sm text-bear">
              The committee stream was interrupted. Try Replay.
            </p>
          )}

          {finished && decision && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="pt-2"
            >
              <VerdictCard decision={decision} />
            </motion.div>
          )}
        </div>
      </div>

      {/* Live scoreboard */}
      <aside className="order-3">
        <ScoreRail scores={scores} reveal={finished} spoke={spokeSet} />
      </aside>
    </div>
  );
}

function Line({
  line,
  text,
  live = false,
}: {
  line: DebateLine;
  text?: string;
  live?: boolean;
}) {
  const agent = AGENT_MAP[line.agent];
  const rebut = line.rebuts ? AGENT_MAP[line.rebuts] : null;
  const isRuling = line.kind === "ruling";

  return (
    <motion.div
      initial={live ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex gap-3"
    >
      <AgentAvatar agent={agent} active={live} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-body-sm font-medium text-bone">{agent.name}</span>
          <span className="text-caption text-mute">{agent.role}</span>
          {kindLabel[line.kind] && rebut && (
            <span className="text-caption text-ash">
              {kindLabel[line.kind]} <span className="text-frost">{rebut.name}</span>
            </span>
          )}
          {isRuling && (
            <span className="inline-flex items-center gap-1 text-caption text-lilac">
              <Gavel className="h-3 w-3" strokeWidth={1.5} /> issues ruling
            </span>
          )}
        </div>
        <p
          className={cn(
            "mt-1 text-body-sm leading-relaxed",
            isRuling ? "text-bone" : "text-frost/90",
            line.kind === "evidence" && "mono text-[13px] text-ash",
            live && "caret",
          )}
        >
          {line.kind === "evidence" && !live && (
            <Quote className="mr-1.5 inline h-3 w-3 -translate-y-0.5 text-mute" strokeWidth={1.5} />
          )}
          {text ?? line.text}
        </p>
      </div>
    </motion.div>
  );
}

function StatusDot({ status }: { status: Status }) {
  if (status === "speaking")
    return <span className="mono text-[10px] text-bull">live</span>;
  if (status === "spoke")
    return <span className="mono text-[10px] text-ash">done</span>;
  if (status === "thinking")
    return (
      <span className="flex items-center gap-0.5" aria-label="thinking">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-1 rounded-pill bg-ash breathe"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </span>
    );
  return <span className="mono text-[10px] text-mute">—</span>;
}
