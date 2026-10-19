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
    <div role="radiogroup" aria-label="Forecast horizon" className="inline-flex rounded-full bg-surface-3 p-0.5">
      {(["1h", "next_session", "5_sessions"] as Horizon[]).map((h) => (
        <button
          key={h}
          type="button"
          role="radio"
          aria-checked={value === h}
          id={`${id}-${h}`}
          onClick={() => onChange(h)}
          className={clsx("h-6 cursor-pointer rounded-full px-2.5 text-2xs font-medium transition-colors", value === h ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]" : "text-ink-2 hover:text-ink")}
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
  // Generic company news has no mechanism worth leading with: show the real headline first.
  const headlineFirst = card.subtype === "other.unclassified" || card.subtype.startsWith("market.") || (card.subtype.startsWith("macro.") && !card.macro);
  const hasAssets = card.exposures.length > 0;
  const genericLine = card.bottomLine.startsWith("A report") || card.bottomLine.startsWith("A market-wide report") || (card.subtype.startsWith("macro.") && !card.macro);
  const facts = headlineFirst ? card.facts.filter((f) => !f.text.startsWith(card.originalTitle.slice(0, 40))) : card.facts;
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
      className={clsx("rounded-[18px] bg-surface outline-offset-2 transition-shadow duration-150", focused ? "outline outline-2 outline-accent/50" : "")}
    >
      <div className="px-4 pb-2.5 pt-3.5 sm:px-5">
        {/* Meta */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-3">
          <Icon className="size-3.5 text-ink-3" aria-hidden strokeWidth={2} />
          <span className="font-medium text-ink-2">{subtypeLabel(card.subtype)}</span>

          <span aria-hidden>·</span>
          <time dateTime={card.firstPublishedAt} title={new Date(card.firstPublishedAt).toISOString()}>
            {stampET(card.firstPublishedAt, asOf)}
          </time>
          <span aria-hidden>·</span>
          <span>{card.sourceName}</span>
          {card.confirmation !== "single_source" ? <Chip tone={card.confirmation === "unverified" ? "warn" : "muted"}>{CONFIRMATION_LABEL[card.confirmation]}</Chip> : null}
          {card.severity === "high" ? <Chip tone="accent">High impact</Chip> : null}
          {card.urgency === "breaking" ? <Chip tone="accent">New · {relative(card.firstPublishedAt, asOf)}</Chip> : null}
          {card.overlapping ? (
            <Chip tone="warn" title="Another catalyst touching the same assets landed within 60 minutes; attribution is ambiguous.">
              Overlapping event
            </Chip>
          ) : null}
          {card.isSynthetic ? <DemoChip /> : null}
        </div>

        {/* Bottom line */}
        <h3 id={`bl-${card.id}`} className="mt-1.5 max-w-[70ch] text-[17px] font-semibold leading-[1.3] text-ink">
          <Link href={`/events/${card.id}`} className="hover:text-accent focus-visible:text-accent">
            {headlineFirst ? card.originalTitle : card.bottomLine}
          </Link>
        </h3>
        {headlineFirst && !genericLine ? <p className="mt-1 max-w-[70ch] text-sm text-ink-2">{card.bottomLine}</p> : null}

        {/* Facts */}
        {facts.length ? (
          <ul className="mt-2 space-y-0.5">
            {facts.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm text-ink-2">
                <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" />
                <span className="min-w-0">
                  {f.text}{" "}
                  <span className="whitespace-nowrap font-mono text-2xs text-ink-3">
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
          <p className="mt-1.5 text-2xs text-ink-3">
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
        {hasAssets && card.transmission.length ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-3" aria-label="Transmission mechanism">
            {card.transmission.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 ? <span aria-hidden className="text-accent">→</span> : null}
                <span>{t}</span>
              </span>
            ))}
          </p>
        ) : null}

        {/* Impact rail */}
        {hasAssets ? (
          <div className="mt-2.5 rounded-xl bg-surface-2 p-2.5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-2">Exposed assets <span className="font-normal text-ink-3">· model view</span></span>
              <HorizonToggle value={horizon} onChange={setHorizon} id={`hz-${card.id}`} />
            </div>
            <ImpactRail exposures={card.exposures} horizon={horizon} />
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-2 text-2xs text-ink-3">
          <span title="Event-quality indicator — not a model confidence.">Evidence quality <span className="num text-ink-2">{card.quality}</span></span>
          <span aria-hidden>·</span>
          <span>{echo.originalCount + echo.echoCount} report{echo.originalCount + echo.echoCount === 1 ? "" : "s"}</span>
          {!hasAssets ? (
            <>
              <span aria-hidden>·</span>
              <span>No asset linked</span>
            </>
          ) : null}
          {card.quarantinedCount ? <span className="text-warn">· {card.quarantinedCount} symbol(s) quarantined</span> : null}
        </div>

        <div className="mt-1.5 -ml-2 flex flex-wrap items-center gap-0.5">
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
            <div className="border-t border-line px-4 py-3 sm:px-5">
              <div className="mb-3 space-y-1 text-2xs text-ink-3">
                <p>
                  Priced in:{" "}
                  {pi && pi.status !== "unknown" ? (
                    <span className="text-ink-2">
                      {pi.ticker} drift {signedPct(pi.preEventDriftPct)} · since publication {signedPct(pi.realizedSincePct)} · remaining {pi.remainingPct === null ? "not estimable" : signedPct(pi.remainingPct)}
                    </span>
                  ) : (
                    <span className="text-ink-2">unknown (no valid pre/post-event quotes)</span>
                  )}
                </p>
                <p>
                  Echo: <span className="text-ink-2">{echo.originalCount} original · {echo.echoCount} echo{echo.echoCount === 1 ? "" : "es"}</span>
                </p>
                {card.topContradiction && hasAssets ? (
                  <p>
                    <span className="text-warn">Contradiction:</span> {card.topContradiction}
                  </p>
                ) : null}
              </div>
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
              {hasAssets ? (
                <div className="mt-4">
                  <ExposureTable exposures={card.exposures} />
                </div>
              ) : null}
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
