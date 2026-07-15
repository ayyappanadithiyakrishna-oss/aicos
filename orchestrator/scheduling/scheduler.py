"""APScheduler-backed daily scheduler.

Why APScheduler over a system cron entry: AICOS already runs as a long-lived Python
process (the same interpreter that holds the committee, stores, and DataFetcher
cache), so an in-process scheduler keeps everything in one place, needs no crontab
installation, behaves identically on macOS and Linux, and can call the exact
`market_hours` logic the dashboard uses. A blocking scheduler makes `main.py --mode
schedule` a clean foreground daemon.

The cron trigger fires once per weekday at the configured ET time; `DailyRunner`
re-validates market hours and enforces once-per-trading-day, so a manual/misfired
wake-up can never double-run or run on a weekend.
"""

from __future__ import annotations

import logging

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from config.settings import SchedulerConfig
from orchestrator.scheduling.daily_runner import DailyRunner

logger = logging.getLogger(__name__)


class DailyScheduler:
    def __init__(self, daily_runner: DailyRunner, config: SchedulerConfig | None = None):
        self.daily_runner = daily_runner
        self.config = config or SchedulerConfig()
        self._scheduler = BlockingScheduler(timezone=self.config.timezone)

    def _job(self) -> None:
        try:
            self.daily_runner.execute(trigger="scheduled")
        except Exception:  # never let one bad run kill the scheduler
            logger.exception("Scheduled watchlist run failed.")

    def _build_trigger(self) -> CronTrigger:
        cfg = self.config
        return CronTrigger(
            day_of_week=cfg.day_of_week,
            hour=cfg.hour,
            minute=cfg.minute,
            timezone=cfg.timezone,
        )

    def start(self) -> None:
        """Register the daily job and block, running until interrupted."""
        cfg = self.config
        self._scheduler.add_job(
            self._job,
            trigger=self._build_trigger(),
            id="daily_watchlist_run",
            name="Daily watchlist run",
            misfire_grace_time=cfg.misfire_grace_seconds,
            coalesce=True,             # collapse missed fires into one
            max_instances=1,           # never overlap runs
            replace_existing=True,
        )
        logger.info(
            "Daily scheduler armed: %s at %02d:%02d %s (next: %s).",
            cfg.day_of_week, cfg.hour, cfg.minute, cfg.timezone,
            self._scheduler.get_job("daily_watchlist_run").next_run_time
            if self._scheduler.get_jobs() else "n/a",
        )
        try:
            self._scheduler.start()
        except (KeyboardInterrupt, SystemExit):
            logger.info("Scheduler stopped.")

    def shutdown(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
