"""Daily scheduler / run-ledger tests — no APScheduler loop, no network."""

from datetime import datetime, timezone

from ledger.runs.store import RunRecord, RunStore, new_run_id
from orchestrator.scheduling.daily_runner import DailyRunner, summarize_run
from orchestrator.scheduling.market_hours import (
    is_market_open,
    is_trading_day,
    market_status,
    trading_day_str,
)

# Reference moments (naive ET wall-clock; helpers read weekday/hour directly).
WED_OPEN = datetime(2026, 7, 15, 10, 0)     # Wednesday, 10:00 → regular session
WED_PRE = datetime(2026, 7, 15, 8, 0)       # Wednesday, 08:00 → pre-market
WED_AFTER = datetime(2026, 7, 15, 17, 0)    # Wednesday, 17:00 → after-hours
WED_NIGHT = datetime(2026, 7, 15, 21, 0)    # Wednesday, 21:00 → closed
SAT = datetime(2026, 7, 18, 10, 0)          # Saturday → closed / non-trading


# ── market_hours ──────────────────────────────────────────────────────────────

def test_market_status_sessions():
    assert market_status(WED_OPEN) == ("OPEN", "open")
    assert market_status(WED_PRE) == ("PRE-MARKET", "pre")
    assert market_status(WED_AFTER) == ("AFTER-HOURS", "after")
    assert market_status(WED_NIGHT) == ("CLOSED", "closed")
    assert market_status(SAT) == ("CLOSED", "closed")


def test_trading_day_and_open_flags():
    assert is_trading_day(WED_OPEN) is True
    assert is_trading_day(SAT) is False
    assert is_market_open(WED_OPEN) is True
    assert is_market_open(WED_PRE) is False
    assert is_market_open(SAT) is False


def test_trading_day_str():
    assert trading_day_str(WED_OPEN) == "2026-07-15"


# ── RunStore (append-only) ────────────────────────────────────────────────────

def _record(trading_day="2026-07-15", trigger="scheduled") -> RunRecord:
    return RunRecord(
        run_id=new_run_id(), run_at=datetime.now(tz=timezone.utc).isoformat(),
        trading_day=trading_day, trigger=trigger, market_status="OPEN",
        watchlist_path="config/watchlist.json", tickers_analysed=3, actionable=1,
        opened=1, closed=0, held=1, passed=1, errored=0, open_positions=2,
        total_unrealized_pnl=123.45, elapsed_seconds=4.2,
        decision_refs=["2026-07-15T14:00:00+00:00"], tickers=[],
    )


def test_run_store_roundtrip_and_queries(tmp_path):
    store = RunStore(tmp_path / "runs.jsonl")
    store.record(_record())
    store.record(_record(trading_day="2026-07-16"))

    assert len(store.load_all()) == 2
    assert store.latest().trading_day == "2026-07-16"
    assert store.has_run_on("2026-07-15") is True
    assert store.has_run_on("2026-07-15", trigger="scheduled") is True
    assert store.has_run_on("2026-07-15", trigger="cli") is False
    assert store.has_run_on("2026-07-17") is False
    # Reloading from a fresh store reads the same append-only file.
    assert len(RunStore(tmp_path / "runs.jsonl").load_all()) == 2


# ── summarize_run ─────────────────────────────────────────────────────────────

class _CR:
    def __init__(self, signal, conf):
        self.timestamp = datetime(2026, 7, 15, 14, 0, tzinfo=timezone.utc)
        self.final_signal = signal
        self.confidence = conf


class _WR:
    def __init__(self, action, signal="buy", conf=0.72):
        self.ledger_action = action
        self.committee_result = _CR(signal, conf)


class _TR:
    def __init__(self, ticker, action=None, error=None):
        self.ticker = ticker
        self.error = error
        self.workflow_result = None if error else _WR(action)


class _Pos:
    def __init__(self, upnl):
        self.unrealized_pnl = upnl


class _WLRun:
    def __init__(self, results, open_positions=None, elapsed=2.5):
        self.results = results
        self.open_positions = open_positions or []
        self.elapsed_seconds = elapsed
        self.watchlist_path = "config/watchlist.json"


def test_summarize_run_counts_and_refs():
    wl = _WLRun(
        results=[
            _TR("AAPL", action="opened"),
            _TR("MSFT", action="closed"),
            _TR("NVDA", action="hold"),
            _TR("TSLA", action="passed"),
            _TR("BOOM", error="boom"),
        ],
        open_positions=[_Pos(100.0), _Pos(-40.0)],
    )
    rec = summarize_run(wl, trigger="cli", market_status_label="OPEN",
                        trading_day="2026-07-15")

    assert rec.tickers_analysed == 5
    assert (rec.opened, rec.closed, rec.held, rec.passed, rec.errored) == (1, 1, 1, 1, 1)
    assert rec.actionable == 2
    assert rec.open_positions == 2
    assert rec.total_unrealized_pnl == 60.0
    # One decision_ref per non-errored ticker.
    assert len(rec.decision_refs) == 4
    assert {t["ticker"] for t in rec.tickers} == {"AAPL", "MSFT", "NVDA", "TSLA", "BOOM"}


def test_summarize_run_pnl_none_when_price_unknown():
    wl = _WLRun(results=[_TR("AAPL", action="opened")],
                open_positions=[_Pos(100.0), _Pos(None)])
    rec = summarize_run(wl, trigger="cli", market_status_label="OPEN",
                        trading_day="2026-07-15")
    assert rec.total_unrealized_pnl is None


# ── DailyRunner.execute ───────────────────────────────────────────────────────

class _FakeRunner:
    def __init__(self, wl_run):
        self.wl_run = wl_run
        self.calls = 0

    def run(self, watchlist_path):
        self.calls += 1
        return self.wl_run


def _daily(tmp_path):
    wl = _WLRun(results=[_TR("AAPL", action="opened")])
    runner = _FakeRunner(wl)
    store = RunStore(tmp_path / "runs.jsonl")
    return DailyRunner(runner, store, watchlist_path="config/watchlist.json"), runner, store


def test_execute_skips_weekend_when_scheduled(tmp_path):
    daily, runner, store = _daily(tmp_path)
    assert daily.execute(trigger="scheduled", now=SAT) is None
    assert runner.calls == 0
    assert store.load_all() == []


def test_execute_dedups_second_scheduled_run_same_day(tmp_path):
    daily, runner, store = _daily(tmp_path)
    first = daily.execute(trigger="scheduled", now=WED_OPEN)
    assert first is not None and runner.calls == 1
    second = daily.execute(trigger="scheduled", now=WED_OPEN)
    assert second is None and runner.calls == 1        # not run again
    assert len(store.load_all()) == 1


def test_execute_manual_bypasses_guards(tmp_path):
    daily, runner, store = _daily(tmp_path)
    # Manual trigger runs even on a weekend and even alongside a scheduled run.
    rec = daily.execute(trigger="manual", now=SAT)
    assert rec is not None and rec.trigger == "manual"
    assert runner.calls == 1
    assert len(store.load_all()) == 1


def test_execute_force_overrides_dedup(tmp_path):
    daily, runner, store = _daily(tmp_path)
    daily.execute(trigger="scheduled", now=WED_OPEN)
    forced = daily.execute(trigger="scheduled", now=WED_OPEN, force=True)
    assert forced is not None
    assert len(store.load_all()) == 2
