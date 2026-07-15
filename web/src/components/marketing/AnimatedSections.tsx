"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { AgentAvatar } from "@/components/committee/AgentAvatar";
import { Pill, TextLink, Eyebrow } from "@/components/ui/primitives";
import { HoloPlane } from "@/components/marketing/HoloPlane";
import { AGENTS } from "@/lib/committee";

/* ── Hero ─────────────────────────────────────────────────── */

export function AnimatedHero() {
  return (
    <section className="relative flex min-h-[calc(100vh-6.5rem)] items-center justify-center overflow-hidden px-5 py-24 text-center">
      {/* ambient convergence mark — the observatory backdrop */}
      <motion.div
        initial={{ opacity: 0, scale: 1.05 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[min(140vw,900px)] -translate-x-1/2 -translate-y-1/2"
      >
        <HoloPlane className="h-full w-full opacity-70" />
      </motion.div>
      {/* onyx vignette so the type stays legible over the mark */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 60% at 50% 45%, rgba(23,23,33,0) 30%, rgba(23,23,33,0.85) 100%)",
        }}
      />

      <div className="relative mx-auto max-w-[720px]">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <span className="inline-flex items-center gap-2 rounded-pill border border-graphite bg-smoke/70 px-4 py-1.5 text-caption text-ash backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-pill bg-cobalt breathe" />
            AI for the buy-side
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="display mt-7 text-display text-bone sm:text-hero"
        >
          Every decision passes
          <br className="hidden sm:block" /> through the committee.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="mx-auto mt-6 max-w-[34rem] text-body-lg text-ash"
        >
          AICOS convenes an institutional investment committee of six specialist
          AI agents. They analyze independently, challenge one another, and rule
          on a thesis — then trade it, live, on Alpaca paper.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.38 }}
          className="mt-9 flex flex-wrap items-center justify-center gap-4"
        >
          <Pill href="/terminal" variant="solid" arrow>
            Open the terminal
          </Pill>
          <TextLink href="#committee">Meet the committee</TextLink>
        </motion.div>
      </div>
    </section>
  );
}

/* ── Logo strip ───────────────────────────────────────────── */

export function AnimatedLogoStrip() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="mx-auto max-w-[1200px] px-5 pb-20">
      <motion.div
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : {}}
        transition={{ duration: 0.6 }}
      >
        <Eyebrow className="text-center">Built for institutional rigor</Eyebrow>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
          {["FAMILY OFFICES", "HEDGE FUNDS", "RIAs", "PROP DESKS", "ALLOCATORS"].map(
            (l, i) => (
              <motion.span
                key={l}
                initial={{ opacity: 0 }}
                animate={inView ? { opacity: 0.7 } : {}}
                transition={{ duration: 0.4, delay: i * 0.07 }}
                className="eyebrow text-frost"
              >
                {l}
              </motion.span>
            ),
          )}
        </div>
      </motion.div>
    </section>
  );
}

/* ── Committee grid ───────────────────────────────────────── */

export function AnimatedCommittee() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
      id="committee"
      className="mx-auto max-w-[1200px] px-5 py-20 text-center"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
      >
        <Eyebrow>The Committee</Eyebrow>
        <h2 className="display mx-auto mt-4 max-w-2xl text-heading-lg text-bone sm:text-display">
          Six specialists. One adversarial process.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-body text-ash">
          Each agent has a mandate and a personality. They don&apos;t agree by
          default — they debate, cite evidence, and concede ground until the
          Chair can rule.
        </p>
      </motion.div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((a, i) => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.45, delay: 0.1 + i * 0.07 }}
            className="rounded-cards border border-graphite bg-carbon/60 p-6 text-left"
          >
            <div className="flex items-center gap-3">
              <AgentAvatar agent={a} size="lg" />
              <div>
                <p className="text-subheading text-bone">{a.name}</p>
                <p className="text-caption text-ash">{a.role}</p>
              </div>
            </div>
            <p className="mt-4 text-body-sm text-ash">{a.mandate}.</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ── Capabilities ─────────────────────────────────────────── */

const CAPABILITIES = [
  [
    "Adversarial committee",
    "Six specialist agents — Bull, Bear, Quant, Macro, Risk, and the Chair — debate every thesis. No rubber stamps.",
  ],
  [
    "Live Alpaca execution",
    "Verdicts don't sit in a doc. The Chair's ruling submits a bracket order to Alpaca paper — entry, stop, and target in one instruction.",
  ],
  [
    "Universe scanner",
    "The desk doesn't wait to be asked. A scanner sweeps the universe for setups worth convening the committee over.",
  ],
  [
    "Scheduled runs",
    "A market-hours-aware runner convenes the committee on a cadence and only when the tape is open — no weekend noise.",
  ],
  [
    "Alerts",
    "Stops, targets, and thesis-breaks raise alerts the moment price crosses the line the committee drew.",
  ],
  [
    "Append-only ledger",
    "Every ruling, order, and fill is written to an immutable ledger — a full audit trail from thesis to P&L.",
  ],
] as const;

export function AnimatedCapabilities() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section ref={ref} id="terminal" className="mx-auto max-w-[1200px] px-5 py-24">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
        className="max-w-2xl"
      >
        <Eyebrow>The system</Eyebrow>
        <h2 className="display mt-4 text-heading-lg text-bone sm:text-display">
          A full desk, not a chatbot.
        </h2>
        <p className="mt-5 max-w-xl text-body text-ash">
          AICOS runs the whole loop — from finding the idea to logging the fill —
          the way a real investment desk does.
        </p>
      </motion.div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map(([title, body], i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.45, delay: 0.1 + i * 0.06 }}
            className="rounded-cards bg-smoke p-8"
          >
            <p className="text-subheading text-bone">{title}</p>
            <p className="mt-3 text-body-sm leading-relaxed text-ash">{body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ── Process steps ────────────────────────────────────────── */

const STEPS = [
  ["01", "Convene",    "Enter a ticker. The committee assembles and pulls live market context."],
  ["02", "Deliberate", "Agents open independently, then cross-examine — challenges and concessions stream live."],
  ["03", "Synthesize", "The Chair weighs every desk, resolves conflicts, and scores the conviction."],
  ["04", "Rule",       "A verdict with price target, stop, sizing, and kill conditions — logged to the ledger."],
] as const;

export function AnimatedProcess() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      id="process"
      className="mx-auto max-w-[1200px] px-5 py-20 text-center"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
      >
        <Eyebrow>The Process</Eyebrow>
        <h2 className="display mx-auto mt-4 max-w-2xl text-heading-lg text-bone sm:text-display">
          From ticker to ruling.
        </h2>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="mt-12 grid gap-px overflow-hidden rounded-cards border border-graphite bg-graphite sm:grid-cols-2 lg:grid-cols-4"
      >
        {STEPS.map(([n, t, d]) => (
          <div key={n} className="bg-carbon p-6 text-left">
            <span className="mono text-caption text-mute">{n}</span>
            <p className="mt-3 text-subheading text-bone">{t}</p>
            <p className="mt-2 text-body-sm text-ash">{d}</p>
          </div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : {}}
        transition={{ duration: 0.4, delay: 0.3 }}
        className="mt-14"
      >
        <Pill href="/terminal" variant="solid" arrow>
          Open the Terminal
        </Pill>
      </motion.div>
    </section>
  );
}
