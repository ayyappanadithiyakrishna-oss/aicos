"use client";
import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import { ArrowUpRight, Bookmark, BookmarkCheck, ChevronDown, Copy, Check, Landmark, FileText, Globe2, Building2, Scale, Fuel, Handshake, Factory, CircleDot } from "lucide-react";
import type { Horizon } from "@/lib/domain/types";
import type { CardModel } from "@/lib/data/cards";
import { CONFIRMATION_LABEL, HORIZON_LONG, HORIZON_SHORT, signedPct, stampET, relative, subtypeLabel } from "@/lib/format";
import { useClientState } from "@/lib/client/store";
import { Chip, DemoChip } from "@/components/ui/primitives";
import { ImpactRail } from "@/components/impact/ImpactRail";
import { ExposureTable } from "@/components/impact/ExposureTable";
import { EVENT_TYPE_LABEL } from "@/lib/domain/types";

const TYPE_ICON = {
  macro: Globe2,
  earnings: Landmark,
  filing: FileText,
  ma: Handshake,
  regulation: Scale,
  geopolitics: Fuel,
  company: Building2,
  sector: Factory,
  other: CircleDot,
} as const;

const LABEL_TEXT: Record<string, string> = {
  confirmed_fact: "Confirmed fact",
  mechanism: "Mechanism",
  model_forecast: "Model forecast",
  observed_move: "Observed",
  open_question: "Open question",
};

export function HorizonToggle({ value, onChange, id }: { value: Horizon; onChange: (h: Horizon) => void; id: string }) {
  return (
    <div role="radiogroup" aria-label="Forecast horizon" className="inline-flex rounded-md border border-line bg-surface-2 p-0.5">
      {(["1h", "next_session", "5_sessions"] as Horizon[]).map((h) => (
        <button
          key={h}
          type="button"
          role="radio"
          aria-checked={value === h}
          id={`${id}-${h}`}
          onClick={() => onChange(h)}
          className={clsx("h-6 cursor-pointer rounded-[4px] px-2 font-mono text-[10px] uppercase tracking-[0.04em] transition-colors", value === h ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink-2")}
          title={HORIZON_LONG[h]}
        >
          {HORIZON_SHORT[h]}
        </button>
      ))}
    </div>
  );
}

export function EventCard({ card, asOf, focused, defaultHorizon = "next_session" }: { card: CardModel; asOf: string; focused?: boolean; defaultHorizon?: Horizon }) {
  const [open, setOpen] = useState(false);
  const [horizon, setHorizon] = useState<Horizon>(defaultHorizon);
  const [copied, setCopied] = useState(false);
  const [state, update] = useClientState();
  const saved = state.bookmarks.some((b) => b.id === card.id);
  const Icon = TYPE_ICON[card.eventType];
  const pi = card.pricedIn;
  const echo = card.novelty;

  const toggleSave = () =>
    update((s) => ({ ...s, bookmarks: saved ? s.bookmarks.filter((b) => b.id !== card.id) : [{ id: card.id, title: card.bottomLine, at: new Date().toISOString() }, ...s.bookmarks].slice(0, 200) }));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/events/${card.id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <article
      id={`card-${card.id}`}
      data-card-id={card.id}
      tabIndex={-1}
      aria-labelledby={`bl-${card.id}`}
      className={clsx("rounded-lg border bg-surface transition-colors duration-150", focused ? "border-accent/60" : "border-line hover:border-line-2")}
    >
      <div className="px-4 pb-3 pt-3.5 sm:px-5">
        {/* Meta */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.05em] text-ink-3">
          <Icon className="size-3.5 text-ink-2" aria-hidden strokeWidth={1.75} />
          <span className="font-semibold text-ink-2">{subtypeLabel(card.subtype)}</span>
          {EVENT_TYPE_LABEL[card.eventType] !== subtypeLabel(card.subtype) ? (
            <>
              <span aria-hidden>·</span>
              <span>{EVENT_TYPE_LABEL[card.eventType]}</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <time dateTime={card.firstPublishedAt} title={new Date(card.firstPublishedAt).toISOString()}>
            {stampET(card.firstPublishedAt, asOf)}
          </time>
          <span aria-hidden>·</span>
          <span className="normal-case tracking-normal">{card.sourceName}</span>
          <Chip tone={card.confirmation === "unverified" ? "warn" : card.confirmation === "single_source" ? "muted" : "accent"} className="normal-case tracking-normal">
            {CONFIRMATION_LABEL[card.confirmation]}
          </Chip>
          {card.severity === "high" ? <Chip tone="ink">High impact</Chip> : null}
          {card.urgency === "breaking" ? <Chip tone="accent">New · {relative(card.firstPublishedAt, asOf)}</Chip> : null}
          {card.overlapping ? (
            <Chip tone="warn" title="Another catalyst touching the same assets landed within 60 minutes; attribution is ambiguous.">
              Overlapping event
            </Chip>
          ) : null}
          {card.isSynthetic ? <DemoChip /> : null}
        </div>

        {/* Bottom line */}
        <h3 id={`bl-${card.id}`} className="mt-2 max-w-[68ch] font-serif text-lg font-medium leading-[1.42] tracking-[-0.003em] text-ink">
          <Link href={`/events/${card.id}`} className="hover:text-accent-strong focus-visible:text-accent-strong">
            {card.bottomLine}
          </Link>
        </h3>

        {/* Facts */}
        {card.facts.length ? (
          <ul className="mt-2.5 space-y-1">
            {card.facts.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm text-ink-2">
                <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" />
                <span className="min-w-0">
                  {f.text}{" "}
                  <span className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3">
                    {LABEL_TEXT[f.label] ?? f.label}
                    {f.evidence ? (
                      <>
                        {" · "}
                        <a href={f.evidence.href} target={f.evidence.external ? "_blank" : undefined} rel={f.evidence.external ? "noopener noreferrer nofollow" : undefined} className="text-accent hover:underline">
                          source
                        </a>
                      </>
                    ) : null}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {card.macro ? (
          <p className="mt-1.5 font-mono text-2xs text-ink-3">
            {card.macro.surprise !== null ? (
              <>
                Surprise <span className="text-ink-2">{card.macro.surprise > 0 ? "+" : ""}{card.macro.surprise} {card.macro.unit === "%" ? "pp" : card.macro.unit}</span> (computed: actual − consensus)
                {card.macro.surpriseZ !== null ? <> · z <span className="text-ink-2">{card.macro.surpriseZ > 0 ? "+" : ""}{card.macro.surpriseZ}</span> vs {card.macro.historyN} past forecast errors</> : null}
              </>
            ) : (
              <>{card.macro.note}</>
            )}
          </p>
        ) : null}

        {/* Transmission */}
        {card.transmission.length ? (
          <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-2" aria-label="Transmission mechanism">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">Transmission</span>
            {card.transmission.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 ? <span aria-hidden className="text-accent">→</span> : null}
                <span>{t}</span>
              </span>
            ))}
          </p>
        ) : null}

        {/* Impact rail */}
        <div className="mt-3 rounded-md border border-line bg-bg/40 p-2.5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-2">Affected · model-estimated abnormal reaction</span>
            <HorizonToggle value={horizon} onChange={setHorizon} id={`hz-${card.id}`} />
          </div>
          <ImpactRail exposures={card.exposures} horizon={horizon} />
        </div>

        {/* Footer */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-3">
          <span title="Priced-in meter never invents a percentage: drift, observed reaction and remaining move are separate.">
            Priced in:{" "}
            {pi && pi.status !== "unknown" ? (
              <span className="text-ink-2">
                {pi.ticker} drift {signedPct(pi.preEventDriftPct)} · since pub {signedPct(pi.realizedSincePct)} · remaining {pi.remainingPct === null ? "not estimable" : signedPct(pi.remainingPct)}
              </span>
            ) : (
              <span className="text-ink-2">Unknown (no valid pre/post-event quotes)</span>
            )}
          </span>
          <span title="One event reported by many outlets counts as one catalyst.">
            Echo: <span className="text-ink-2">{echo.originalCount} original · {echo.echoCount} echo{echo.echoCount === 1 ? "" : "es"}</span>
          </span>
          <span title="Event-quality indicator (source reliability, verified facts, timeliness, freshness, quantified evidence, distinctiveness) — not a model confidence.">
            Evidence quality <span className="num font-mono text-ink-2">{card.quality}</span>
          </span>
          {card.quarantinedCount ? <span className="text-warn">{card.quarantinedCount} symbol(s) quarantined</span> : null}
        </div>
        {card.topContradiction ? (
          <p className="mt-1 line-clamp-2 text-2xs text-ink-3">
            <span className="text-warn">Contradiction:</span> {card.topContradiction}
          </p>
        ) : null}

        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`mech-${card.id}`} data-action="expand" className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink">
            <ChevronDown className={clsx("size-3.5 transition-transform duration-150", open && "rotate-180")} aria-hidden />
            {open ? "Hide mechanics" : "View mechanics"}
          </button>
          <Link href={`/events/${card.id}`} className="inline-flex h-7 items-center rounded-md px-2 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink">
            Dossier
          </Link>
          <Link href={`/impact-map?event=${card.id}`} className="hidden h-7 items-center rounded-md px-2 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink sm:inline-flex">
            Impact map
          </Link>
          {card.primarySource ? (
            <a href={card.primarySource.href} target={card.primarySource.external ? "_blank" : undefined} rel={card.primarySource.external ? "noopener noreferrer nofollow" : undefined} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink">
              Source <ArrowUpRight className="size-3" aria-hidden />
            </a>
          ) : null}
          <span className="ml-auto flex items-center gap-0.5">
            <button type="button" onClick={toggleSave} data-action="bookmark" aria-pressed={saved} aria-label={saved ? "Remove bookmark" : "Bookmark"} className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink">
              {saved ? <BookmarkCheck className="size-3.5 text-accent" /> : <Bookmark className="size-3.5" />}
            </button>
            <button type="button" onClick={copy} aria-label="Copy link" className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink">
              {copied ? <Check className="size-3.5 text-pos" /> : <Copy className="size-3.5" />}
            </button>
          </span>
        </div>
      </div>

      {/* Expanded mechanics */}
      <div className="collapse-grid" data-open={open} id={`mech-${card.id}`}>
        <div>
          {open ? (
            <div className="border-t border-line px-4 py-3.5 sm:px-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-2xs font-medium text-ink-3">Scenarios</div>
                  <p className="mt-1 text-sm text-ink-2">
                    <span className="text-pos">Upside:</span> {card.scenario.upside}
                  </p>
                  <p className="mt-1 text-sm text-ink-2">
                    <span className="text-neg">Downside:</span> {card.scenario.downside}
                  </p>
                </div>
                <div>
                  <div className="text-2xs font-medium text-ink-3">Original headline</div>
                  <p className="mt-1 text-sm text-ink-2">{card.originalTitle}</p>
                  <p className="mt-1 text-2xs text-ink-3">
                    Extraction: {card.extractionMethod === "llm_validated" ? "model-assisted, schema- and evidence-validated" : "deterministic rules (no AI processed this content)"}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <ExposureTable exposures={card.exposures} />
              </div>
              {card.limitations.length ? (
                <ul className="mt-3 space-y-0.5 text-2xs text-ink-3">
                  {card.limitations.map((l) => (
                    <li key={l}>· {l}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
