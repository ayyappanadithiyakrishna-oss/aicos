"""Daily run job — the scheduler-agnostic core.

Runs the watchlist once, summarizes the outcome into a RunRecord, and appends it to
the run ledger. Kept independent of APScheduler so it can be unit-tested and invoked
directly (e.g. from `main.py --mode watchlist`). `DailyScheduler` simply calls
`DailyRunner.execute` on a cron trigger.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from ledger.runs.store import RunRecord, RunStore, new_run_id
from orchestrator.scheduling.market_hours import (
    is_trading_day,
    market_status,
    trading_day_str,
)

if TYPE_CHECKING:
    from orchestrator.workflows.watchlist_runner import WatchlistRun, WatchlistRunner

logger = logging.getLogger(__name__)


def summarize_run(
    wl_run: "WatchlistRun",
    *,
    trigger: str,
    market_status_label: str,
    trading_day: str,
) -> RunRecord:
    """Aggregate a WatchlistRun into a single RunRecord."""
    opened = closed = held = passed = errored = 0
    decision_refs: list[str] = []
    tickers: list[dict] = []

    for r in wl_run.results:
        wr = r.workflow_result
        if r.error or wr is None:
            errored += 1
            tickers.append({
                "ticker": r.ticker, "signal": None, "confidence": None,
                "action": "error", "error": r.error or "unknown error",
            })
            continue

        action = wr.ledger_action
        if action == "opened":
            opened += 1
        elif action == "closed":
            closed += 1
        elif action == "hold":
            held += 1
        else:  # passed / pending / failed / anything else
            passed += 1

        cr = wr.committee_result
        decision_refs.append(cr.timestamp.isoformat())
        tickers.append({
            "ticker": r.ticker,
            "signal": cr.final_signal,
            "confidence": round(cr.confidence, 4),
            "action": action,
            "error": None,
        })

    # Total unrealized P&L across open positions (None when any price is unknown).
    total_upnl: float | None = 0.0
    for s in wl_run.open_positions:
        if s.unrealized_pnl is None:
            total_upnl = None
            break
        total_upnl += s.unrealized_pnl

    return RunRecord(
        run_id=new_run_id(),
        run_at=datetime.now(tz=timezone.utc).isoformat(),
        trading_day=trading_day,
        trigger=trigger,
        market_status=market_status_label,
        watchlist_path=str(wl_run.watchlist_path),
        tickers_analysed=len(wl_run.results),
        actionable=opened + closed,
        opened=opened,
        closed=closed,
        held=held,
        passed=passed,
        errored=errored,
        open_positions=len(wl_run.open_positions),
        total_unrealized_pnl=(round(total_upnl, 2) if total_upnl is not None else None),
        elapsed_seconds=round(wl_run.elapsed_seconds, 2),
        decision_refs=decision_refs,
        tickers=tickers,
    )


class DailyRunner:
    def __init__(
        self,
        runner: "WatchlistRunner",
        run_store: RunStore,
        watchlist_path: Path | str = Path("config/watchlist.json"),
    ):
        self.runner = runner
        self.run_store = run_store
        self.watchlist_path = Path(watchlist_path)

    def execute(
        self,
        trigger: str = "scheduled",
        now: datetime | None = None,
        force: bool = False,
    ) -> RunRecord | None:
        """Run the watchlist and record a RunRecord.

        For the scheduled trigger this enforces market-hours discipline:
          • skips weekends / non-trading days, and
          • runs at most once per trading day.
        `force=True` and non-scheduled triggers (manual/cli) bypass those guards.
        Returns the recorded RunRecord, or None when the run was skipped.
        """
        trading_day = trading_day_str(now)
        status_label = market_status(now)[0]
        scheduled = trigger == "scheduled" and not force

        if scheduled and not is_trading_day(now):
            logger.info("Skipping run on non-trading day %s (market %s).",
                        trading_day, status_label)
            return None

        if scheduled and self.run_store.has_run_on(trading_day, trigger="scheduled"):
            logger.info("Scheduled run already recorded for %s — skipping duplicate.",
                        trading_day)
            return None

        logger.info("Starting %s watchlist run for %s (market %s).",
                    trigger, trading_day, status_label)
        wl_run = self.runner.run(watchlist_path=self.watchlist_path)
        record = summarize_run(
            wl_run,
            trigger=trigger,
            market_status_label=status_label,
            trading_day=trading_day,
        )
        self.run_store.record(record)
        logger.info(
            "Run %s recorded: %d analysed, %d actionable (%d opened, %d closed), "
            "%d errored, %.1fs.",
            record.run_id, record.tickers_analysed, record.actionable,
            record.opened, record.closed, record.errored, record.elapsed_seconds,
        )
        return record
