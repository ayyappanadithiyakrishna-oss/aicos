"""
Watchlist runner.

Reads a ticker list from config/watchlist.json, runs InvestmentReviewWorkflow
on each ticker sequentially, and produces a daily summary report showing which
tickers were analysed, which generated actionable ledger writes (opened/closed),
which were below the conviction threshold, and all currently open positions with
their unrealized P&L.

All market data goes through DataFetcher — no independent yfinance calls here.

Watchlist JSON schema
─────────────────────
{
  "default_timeframe": "12 months",
  "tickers": [
    "AAPL",
    "MSFT",
    {"symbol": "NVDA", "timeframe": "6 months"},
    ...
  ]
}
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from ledger.positions.store import Position, PositionStore

if TYPE_CHECKING:
    from data.fetcher import DataFetcher
    from orchestrator.workflows.investment_review import InvestmentReviewWorkflow, WorkflowResult


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class TickerResult:
    ticker: str
    timeframe: str
    price: float | None                       # current price at time of run
    workflow_result: "WorkflowResult | None"  # None when an exception occurred
    error: str | None
    elapsed_seconds: float


@dataclass
class OpenPositionSummary:
    position: Position
    current_price: float | None
    unrealized_pnl: float | None      # (current - avg_cost) * shares
    unrealized_pnl_pct: float | None  # (current / avg_cost) - 1


@dataclass
class WatchlistRun:
    run_date: datetime
    watchlist_path: Path
    results: list[TickerResult]
    open_positions: list[OpenPositionSummary]
    elapsed_seconds: float


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

class WatchlistRunner:
    def __init__(
        self,
        workflow: "InvestmentReviewWorkflow",
        position_store: PositionStore,
        fetcher: "DataFetcher | None" = None,
    ):
        self.workflow = workflow
        self.position_store = position_store
        # fetcher is used ONLY to look up current prices for open positions that
        # were not in today's watchlist run (and therefore have no cached price from
        # the workflow's own fetcher call).  When the workflow already has a fetcher
        # wired in, that same instance should be passed here so the file cache is shared.
        self._fetcher = fetcher

    def run(
        self,
        watchlist_path: Path | str = Path("config/watchlist.json"),
    ) -> WatchlistRun:
        watchlist_path = Path(watchlist_path)
        run_start = time.monotonic()
        run_date = datetime.now(tz=timezone.utc)

        tickers = _load_watchlist(watchlist_path)
        results: list[TickerResult] = []

        for ticker, timeframe in tickers:
            t0 = time.monotonic()
            try:
                # The workflow auto-fetches data via its DataFetcher when none is
                # provided.  Passing no data= here is intentional.
                wr = self.workflow.run(ticker=ticker, timeframe=timeframe)
                # Retrieve the price that was used (either from pipeline or None)
                price = wr.ticker_data.current_price() if wr.ticker_data else None
                results.append(TickerResult(
                    ticker=ticker,
                    timeframe=timeframe,
                    price=price,
                    workflow_result=wr,
                    error=None,
                    elapsed_seconds=time.monotonic() - t0,
                ))
            except Exception as exc:  # noqa: BLE001
                results.append(TickerResult(
                    ticker=ticker,
                    timeframe=timeframe,
                    price=None,
                    workflow_result=None,
                    error=str(exc),
                    elapsed_seconds=time.monotonic() - t0,
                ))

        open_positions = self._summarise_open_positions()

        return WatchlistRun(
            run_date=run_date,
            watchlist_path=watchlist_path,
            results=results,
            open_positions=open_positions,
            elapsed_seconds=time.monotonic() - run_start,
        )

    # ── Open-position current prices ─────────────────────────────────────────

    def _summarise_open_positions(self) -> list[OpenPositionSummary]:
        summaries: list[OpenPositionSummary] = []
        for pos in self.position_store.all_open():
            price = self._get_price(pos.ticker)
            if price is not None:
                upnl = (price - pos.avg_cost) * pos.shares
                upnl_pct = (price / pos.avg_cost - 1.0) if pos.avg_cost else None
            else:
                upnl = None
                upnl_pct = None
            summaries.append(OpenPositionSummary(
                position=pos,
                current_price=price,
                unrealized_pnl=upnl,
                unrealized_pnl_pct=upnl_pct,
            ))
        return sorted(summaries, key=lambda s: s.position.ticker)

    def _get_price(self, ticker: str) -> float | None:
        """Return current price from the DataFetcher cache (prefers the cache
        warmed by the watchlist run; makes a fresh fetch only on a cache miss)."""
        if self._fetcher is None:
            return None
        try:
            td = self._fetcher.fetch(ticker)
            return td.current_price()
        except Exception:
            return None


# ---------------------------------------------------------------------------
# Watchlist loader
# ---------------------------------------------------------------------------

def _load_watchlist(path: Path) -> list[tuple[str, str]]:
    """Return (ticker, timeframe) pairs from the watchlist JSON file."""
    raw = json.loads(path.read_text())
    default_tf = raw.get("default_timeframe", "12 months")
    result: list[tuple[str, str]] = []
    for entry in raw.get("tickers", []):
        if isinstance(entry, str):
            result.append((entry.upper(), default_tf))
        elif isinstance(entry, dict):
            result.append((entry["symbol"].upper(), entry.get("timeframe", default_tf)))
    return result


# ---------------------------------------------------------------------------
# Summary formatter
# ---------------------------------------------------------------------------

W = 74


def format_summary(run: WatchlistRun, conviction_threshold: float = 0.65) -> str:
    lines: list[str] = []

    def line(s: str = "") -> None:
        lines.append(s)

    def header(title: str) -> None:
        line("═" * W)
        line(f"  {title}")
        line("═" * W)

    def section(title: str) -> None:
        line()
        line(f"  {'─' * (W - 2)}")
        line(f"  {title}")
        line(f"  {'─' * (W - 2)}")

    # ── Partition results ─────────────────────────────────────────────────
    opened:  list[TickerResult] = []
    closed:  list[TickerResult] = []
    held:    list[TickerResult] = []
    passed:  list[TickerResult] = []
    errored: list[TickerResult] = []

    for r in run.results:
        if r.error or r.workflow_result is None:
            errored.append(r)
        else:
            act = r.workflow_result.ledger_action
            if act == "opened":
                opened.append(r)
            elif act == "closed":
                closed.append(r)
            elif act == "hold":
                held.append(r)
            else:
                passed.append(r)

    actionable = len(opened) + len(closed)
    total = len(run.results)

    # ── Header ───────────────────────────────────────────────────────────
    header(
        f"AICOS Watchlist Run\n"
        f"  {run.run_date.strftime('%Y-%m-%d %H:%M:%S UTC')}"
        f"  |  {run.watchlist_path}\n"
        f"  {total} tickers analysed"
        f"  |  {actionable} actionable"
        f"  |  {run.elapsed_seconds:.1f}s"
    )

    # ── Opened ────────────────────────────────────────────────────────────
    if opened:
        section(f"Opened ({len(opened)})")
        for r in opened:
            wr = r.workflow_result
            sz = wr.size_result
            conf = wr.committee_result.confidence
            price_str = f"${r.price:,.2f}" if r.price else "n/a"
            shares_str = f"{wr.transaction.shares:.4f} sh" if wr.transaction else ""
            notional_str = f"${sz.notional:,.0f}" if sz else ""
            tier_str = sz.tier_label if sz else ""
            dq_flag = " [data-limited]" if (
                wr.ticker_data and wr.ticker_data.data_quality.is_data_limited
            ) else ""
            line(
                f"  \U0001f7e2 {r.ticker:<6}  {price_str:>10}  {shares_str:<14}"
                f"  {notional_str:<8}  {tier_str:<20}  {conf:.1%}{dq_flag}"
            )

    # ── Closed ────────────────────────────────────────────────────────────
    if closed:
        section(f"Closed ({len(closed)})")
        for r in closed:
            wr = r.workflow_result
            tx = wr.transaction
            conf = wr.committee_result.confidence
            price_str = f"${r.price:,.2f}" if r.price else "n/a"
            if tx and wr.position:
                pnl = (tx.price - wr.position.avg_cost) * wr.position.shares
                pnl_pct = (tx.price / wr.position.avg_cost - 1.0) if wr.position.avg_cost else 0.0
                pnl_str = f"P&L ${pnl:+,.2f} ({pnl_pct:+.1%})"
            else:
                pnl_str = ""
            line(
                f"  \U0001f534 {r.ticker:<6}  {price_str:>10}  {pnl_str:<30}  {conf:.1%}"
            )

    # ── Held ──────────────────────────────────────────────────────────────
    if held:
        section(f"Hold — above threshold, no change ({len(held)})")
        line(f"  {'Ticker':<8}  {'Signal':<8}  {'Confidence':>10}  Reason")
        line(f"  {'─' * 8}  {'─' * 8}  {'─' * 10}  {'─' * 20}")
        for r in held:
            wr = r.workflow_result
            sig = wr.committee_result.final_signal.upper()
            conf = wr.committee_result.confidence
            reason = wr.ledger_reasoning.replace("HOLD — ", "").split(".")[0].strip()
            line(f"  {r.ticker:<8}  {sig:<8}  {conf:>10.1%}  {reason[:32]}")

    # ── Passed ────────────────────────────────────────────────────────────
    if passed:
        section(f"Below threshold — no action ({len(passed)})")
        line(
            f"  {'Ticker':<8}  {'Signal':<8}  {'Confidence':>10}"
            f"  {'Threshold':>10}  Gap"
        )
        line(
            f"  {'─' * 8}  {'─' * 8}  {'─' * 10}"
            f"  {'─' * 10}  {'─' * 6}"
        )
        for r in passed:
            wr = r.workflow_result
            sig = wr.committee_result.final_signal.upper()
            conf = wr.committee_result.confidence
            gap = conviction_threshold - conf
            dq = " [data-limited]" if (
                wr.ticker_data and wr.ticker_data.data_quality.is_data_limited
            ) else ""
            line(
                f"  {r.ticker:<8}  {sig:<8}  {conf:>10.1%}"
                f"  {conviction_threshold:>10.1%}  -{gap:.1%}{dq}"
            )

    # ── Errors ────────────────────────────────────────────────────────────
    if errored:
        section(f"Errors ({len(errored)})")
        for r in errored:
            msg = (r.error or "unknown error")[:60]
            line(f"  ⚠️  {r.ticker:<8}  {msg}")

    # ── Current open positions ────────────────────────────────────────────
    section("Current Open Positions")
    if not run.open_positions:
        line("  (none)")
    else:
        line(
            f"  {'Ticker':<8}  {'Shares':>10}  {'Entry':>9}  {'Current':>9}"
            f"  {'Unrealized P&L':>16}  {'Return':>7}"
        )
        line(
            f"  {'─' * 8}  {'─' * 10}  {'─' * 9}  {'─' * 9}"
            f"  {'─' * 16}  {'─' * 7}"
        )
        total_upnl = 0.0
        all_known = True
        for s in run.open_positions:
            cur_str = f"${s.current_price:,.2f}" if s.current_price else "  n/a"
            if s.unrealized_pnl is not None:
                sign = "+" if s.unrealized_pnl >= 0 else ""
                upnl_str = f"{sign}${s.unrealized_pnl:,.2f}"
                ret_str = f"{s.unrealized_pnl_pct:+.1%}" if s.unrealized_pnl_pct is not None else "n/a"
                total_upnl += s.unrealized_pnl
            else:
                upnl_str = "n/a"
                ret_str = "n/a"
                all_known = False
            line(
                f"  {s.position.ticker:<8}  {s.position.shares:>10.4f}"
                f"  ${s.position.avg_cost:>8,.2f}  {cur_str:>9}"
                f"  {upnl_str:>16}  {ret_str:>7}"
            )

        line()
        if all_known and run.open_positions:
            sign = "+" if total_upnl >= 0 else ""
            line(f"  Total unrealized P&L: {sign}${total_upnl:,.2f}")
        elif run.open_positions:
            line("  Total unrealized P&L: n/a (some prices unavailable)")

    line()
    line("═" * W)
    line()
    return "\n".join(lines)
