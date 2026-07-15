"""Performance tracker tests — synthetic trades, no API/yfinance calls."""

from datetime import datetime, timezone

from benchmarks.metrics.performance import ClosedTrade, PerformanceTracker


def _dt(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


SYNTHETIC_TRADES = [
    ClosedTrade(
        ticker="AAPL", entry_price=227.50, exit_price=241.80,
        entry_date=_dt("2025-01-06"), exit_date=_dt("2025-02-03"),
        shares=1.0, entry_conviction=0.71,
        pnl=14.30, pnl_pct=0.0629, hold_days=28, entry_decision_ref="",
    ),
    ClosedTrade(
        ticker="NVDA", entry_price=138.85, exit_price=121.42,
        entry_date=_dt("2025-01-13"), exit_date=_dt("2025-02-10"),
        shares=1.0, entry_conviction=0.57,
        pnl=-17.43, pnl_pct=-0.1255, hold_days=28, entry_decision_ref="",
    ),
    ClosedTrade(
        ticker="MSFT", entry_price=415.00, exit_price=438.75,
        entry_date=_dt("2025-02-03"), exit_date=_dt("2025-03-03"),
        shares=1.0, entry_conviction=0.68,
        pnl=23.75, pnl_pct=0.0572, hold_days=28, entry_decision_ref="",
    ),
    ClosedTrade(
        ticker="GOOGL", entry_price=190.25, exit_price=198.40,
        entry_date=_dt("2025-02-10"), exit_date=_dt("2025-03-10"),
        shares=1.0, entry_conviction=0.62,
        pnl=8.15, pnl_pct=0.0428, hold_days=28, entry_decision_ref="",
    ),
    ClosedTrade(
        ticker="TSLA", entry_price=380.50, exit_price=254.10,
        entry_date=_dt("2025-03-03"), exit_date=_dt("2025-04-01"),
        shares=1.0, entry_conviction=0.56,
        pnl=-126.40, pnl_pct=-0.3322, hold_days=29, entry_decision_ref="",
    ),
    ClosedTrade(
        ticker="AAPL", entry_price=198.50, exit_price=213.20,
        entry_date=_dt("2025-04-07"), exit_date=_dt("2025-05-05"),
        shares=1.0, entry_conviction=0.73,
        pnl=14.70, pnl_pct=0.0740, hold_days=28, entry_decision_ref="",
    ),
    ClosedTrade(
        ticker="META", entry_price=578.00, exit_price=625.40,
        entry_date=_dt("2025-05-05"), exit_date=_dt("2025-06-02"),
        shares=1.0, entry_conviction=0.69,
        pnl=47.40, pnl_pct=0.0820, hold_days=28, entry_decision_ref="",
    ),
    ClosedTrade(
        ticker="AMZN", entry_price=218.00, exit_price=227.85,
        entry_date=_dt("2025-06-02"), exit_date=_dt("2025-06-30"),
        shares=1.0, entry_conviction=0.61,
        pnl=9.85, pnl_pct=0.0452, hold_days=28, entry_decision_ref="",
    ),
    ClosedTrade(
        ticker="MSFT", entry_price=437.80, exit_price=468.20,
        entry_date=_dt("2025-07-07"), exit_date=_dt("2025-08-04"),
        shares=1.0, entry_conviction=0.70,
        pnl=30.40, pnl_pct=0.0694, hold_days=28, entry_decision_ref="",
    ),
    ClosedTrade(
        ticker="NVDA", entry_price=108.50, exit_price=131.20,
        entry_date=_dt("2025-08-04"), exit_date=_dt("2025-09-01"),
        shares=1.0, entry_conviction=0.65,
        pnl=22.70, pnl_pct=0.2092, hold_days=28, entry_decision_ref="",
    ),
]


def test_trade_counts():
    tracker = PerformanceTracker(SYNTHETIC_TRADES)
    m = tracker.compute()
    assert m.num_trades == 10
    assert m.num_wins == 8
    assert m.num_losses == 2


def test_win_rate():
    m = PerformanceTracker(SYNTHETIC_TRADES).compute()
    assert abs(m.win_rate - 0.8) < 0.01


def test_sharpe_computed():
    m = PerformanceTracker(SYNTHETIC_TRADES).compute()
    assert m.sharpe_ratio is not None


def test_max_drawdown_non_negative():
    m = PerformanceTracker(SYNTHETIC_TRADES).compute()
    assert m.max_drawdown_pct >= 0


def test_conviction_edge():
    m = PerformanceTracker(SYNTHETIC_TRADES).compute()
    assert m.avg_conviction_wins is not None
    assert m.avg_conviction_losses is not None
    assert m.avg_conviction_wins > m.avg_conviction_losses


def test_rolling_sharpe_with_window():
    tracker = PerformanceTracker(SYNTHETIC_TRADES, rolling_window=5)
    m = tracker.compute()
    assert len(m.rolling_sharpe) >= 1


def test_total_pnl_positive():
    m = PerformanceTracker(SYNTHETIC_TRADES).compute()
    assert m.total_pnl > 0
