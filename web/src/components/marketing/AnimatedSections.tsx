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
    <section className="mx-auto grid max-w-[1200px] items-center gap-10 px-5 py-20 lg:grid-cols-2 lg:py-28">
      <div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Eyebrow>AI for the buy-side</Eyebrow>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="display mt-5 text-display leading-[1.05] text-bone sm:text-display-lg"
        >
          Every decision passes through the committee.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="mt-6 max-w-md text-body text-ash"
        >
          AICOS replicates an institutional investment committee. Six specialist
          AI agents independently analyze, challenge one another, and rule on a
          thesis — before a dollar of capital moves.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.38 }}
          className="mt-8 flex items-center gap-5"
        >
          <Pill href="/terminal" variant="solid" arrow>
            Launch Terminal
          </Pill>
          <TextLink href="#committee">See the committee</TextLink>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto aspect-square w-full max-w-md"
      >
        <HoloPlane className="h-full w-full" />
      </motion.div>
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
