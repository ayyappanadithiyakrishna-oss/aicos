"use client";

import { useMemo, useState } from "react";
import { Users, ChevronRight } from "lucide-react";
import { getQuote } from "@/lib/market";
import { WATCHLIST } from "@/lib/demo";
import { useQuotes } from "@/lib/useQuotes";
import { useOrders } from "@/lib/useOrders";
import type { Decision } from "@/lib/committee";
import { Panel } from "@/components/ui/primitives";
import { ChartPanel } from "./ChartPanel";
import { QuotePanel } from "./QuotePanel";
import { OrderEntry } from "./OrderEntry";
import { TickerSearch } from "./TickerSearch";
import { PaperPortfolio } from "./PaperPortfolio";
import { MacroBar, PortfolioPanel, WatchlistPanel, NewsPanel } from "./SidePanels";
import { CommitteeRoom } from "@/components/committee/CommitteeRoom";
import { cn } from "@/lib/utils";

const AICOS_ACCOUNT = process.env.NEXT_PUBLIC_AICOS_ACCOUNT ?? "";

export function TerminalApp({ initial = "NVDA" }: { initial?: string }) {
  const [ticker, setTicker] = useState(initial);
  const [convened, setConvened] = useState(false);
  // committee rulings by ticker + the spot price when the ruling landed
  const [verdicts, setVerdicts] = useState<
    Record<string, { decision: Decision; refPrice: number }>
  >({});

  const symbols = useMemo(
    () => Array.from(new Set([ticker, ...WATCHLIST.map((w) => w.ticker)])),
    [ticker],
  );
  const { quotes, updatedAt } = useQuotes(symbols);
  const quote = quotes[ticker] ?? { ...getQuote(ticker), isRealTime: false };
  // "RH LIVE" when sourced real-time from Robinhood; "DELAYED" on Yahoo fallback.
  const rhLive = quote.isRealTime === true;

  const { open: openOrders } = useOrders(AICOS_ACCOUNT);
  const verdictEntry = verdicts[ticker];
  const verdict = verdictEntry?.decision;
  const referencePrice = verdictEntry?.refPrice;

  function select(t: string) {
    const up = t.toUpperCase().trim();
    if (!up) return;
    setTicker(up);
    setConvened(true);
  }

  return (
    <div className="grid-canvas min-h-[calc(100vh-3.5rem)]">
      <div className="border-b border-graphite/80 bg-void/40">
        <MacroBar />
      </div>

      <div className="mx-auto max-w-[1400px] px-4 py-4">
        {/* search */}
        <div className="mb-4">
          <TickerSearch onSelect={select} current={ticker} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          {/* main column */}
          <div className="space-y-4">
            <Panel
              title="Quote"
              action={
                <span className="flex items-center gap-1.5 mono text-[10px] text-mute">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-pill",
                      rhLive ? "bg-bull breathe" : "bg-mute",
                    )}
                  />
                  {rhLive ? "RH LIVE" : "DELAYED"}
                  {updatedAt && (
                    <span className="text-mute">
                      · {new Date(updatedAt).toLocaleTimeString("en-US", { hour12: false })}
                    </span>
                  )}
                </span>
              }
            >
              <QuotePanel quote={quote} />
            </Panel>

            <Panel
              title={`${ticker} · Daily`}
              action={<span className="mono text-[10px] text-mute">TradingView</span>}
            >
              <div className="h-[420px]">
                <ChartPanel symbol={ticker} />
              </div>
            </Panel>

            {/* committee */}
            <section id="committee">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-lilac" strokeWidth={1.5} />
                  <h3 className="display text-heading text-bone">
                    Investment Committee
                  </h3>
                </div>
                {!convened && (
                  <button
                    onClick={() => setConvened(true)}
                    className="inline-flex items-center gap-1 rounded-pill border border-ash/60 px-4 py-1.5 text-body-sm text-bone hover:bg-bone/5"
                  >
                    Convene on {ticker}
                    <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                )}
              </div>
              {convened ? (
                <CommitteeRoom
                  key={ticker}
                  ticker={ticker}
                  onDecision={(d) =>
                    setVerdicts((v) => ({
                      ...v,
                      [d.ticker]: {
                        decision: d,
                        refPrice: quotes[d.ticker]?.last ?? quote.last,
                      },
                    }))
                  }
                />
              ) : (
                <div className="grid place-items-center rounded-cards border border-dashed border-graphite py-16 text-center">
                  <p className="text-body-sm text-ash">
                    Select a ticker to convene the committee.
                  </p>
                </div>
              )}
            </section>
          </div>

          {/* right rail */}
          <div className="space-y-4">
            <Panel title="Order Entry">
              <OrderEntry
                quote={quote}
                verdict={verdict}
                referencePrice={referencePrice}
                accountNumber={AICOS_ACCOUNT}
              />
            </Panel>
            <Panel title="Paper Portfolio">
              <PaperPortfolio ticker={ticker} />
            </Panel>
            <Panel title="Portfolio">
              <PortfolioPanel onSelect={select} orders={openOrders} />
            </Panel>
            <Panel title="Watchlist">
              <WatchlistPanel onSelect={select} active={ticker} quotes={quotes} />
            </Panel>
            <Panel title="Market News">
              <NewsPanel />
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
