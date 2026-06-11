"""
Performance tracker and weekly report test.

Uses synthetic ClosedTrade objects — no ledger files, no API calls for
AICOS metrics.  The benchmark comparison (SPY/QQQ) makes real yfinance calls
using historical dates so the prices are stable and repeatable.

Usage:
    python3 tests/test_performance.py   (from /Users/preeya/aicos)
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from benchmarks.metrics.performance import ClosedTrade, PerformanceTracker
from benchmarks.reports.weekly_summary import format_report, generate_from_trades

# ---------------------------------------------------------------------------
# Synthetic trade history (10 closed trades, 8 wins / 2 losses)
# Uses real historical dates so SPY/QQQ prices are fetchable.
# Dates chosen to be well in the past and on weekdays.
# ---------------------------------------------------------------------------

def _dt(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


SYNTHETIC_TRADES = [
    # Win — high conviction — AAPL Q1 2025
    ClosedTrade(
        ticker="AAPL", entry_price=227.50, exit_price=241.80,
        entry_date=_dt("2025-01-06"), exit_date=_dt("2025-02-03"),
        shares=1.0, entry_conviction=0.71,
        pnl=(241.80 - 227.50), pnl_pct=(241.80 / 227.50 - 1), hold_days=28,
        entry_decision_ref="",
    ),
    # Loss — low conviction — NVDA short hold
    ClosedTrade(
        ticker="NVDA", entry_price=138.85, exit_price=121.42,
        entry_date=_dt("2025-01-13"), exit_date=_dt("2025-02-10"),
        shares=1.0, entry_conviction=0.57,
        pnl=(121.42 - 138.85), pnl_pct=(121.42 / 138.85 - 1), hold_days=28,
        entry_decision_ref="",
    ),
    # Win — high conviction — MSFT
    ClosedTrade(
        ticker="MSFT", entry_price=415.00, exit_price=438.75,
        entry_date=_dt("2025-02-03"), exit_date=_dt("2025-03-03"),
        shares=1.0, entry_conviction=0.68,
        pnl=(438.75 - 415.00), pnl_pct=(438.75 / 415.00 - 1), hold_days=28,
        entry_decision_ref="",
    ),
    # Win — moderate conviction — GOOGL
    ClosedTrade(
        ticker="GOOGL", entry_price=190.25, exit_price=198.40,
        entry_date=_dt("2025-02-10"), exit_date=_dt("2025-03-10"),
        shares=1.0, entry_conviction=0.62,
        pnl=(198.40 - 190.25), pnl_pct=(198.40 / 190.25 - 1), hold_days=28,
        entry_decision_ref="",
    ),
    # Loss — very low conviction — TSLA
    ClosedTrade(
        ticker="TSLA", entry_price=380.50, exit_price=254.10,
        entry_date=_dt("2025-03-03"), exit_date=_dt("2025-04-01"),
        shares=1.0, entry_conviction=0.56,
        pnl=(254.10 - 380.50), pnl_pct=(254.10 / 380.50 - 1), hold_days=29,
        entry_decision_ref="",
    ),
    # Win — high conviction — AAPL again
    ClosedTrade(
        ticker="AAPL", entry_price=198.50, exit_price=213.20,
        entry_date=_dt("2025-04-07"), exit_date=_dt("2025-05-05"),
        shares=1.0, entry_conviction=0.73,
        pnl=(213.20 - 198.50), pnl_pct=(213.20 / 198.50 - 1), hold_days=28,
        entry_decision_ref="",
    ),
    # Win — high conviction — META
    ClosedTrade(
        ticker="META", entry_price=578.00, exit_price=625.40,
        entry_date=_dt("2025-05-05"), exit_date=_dt("2025-06-02"),
        shares=1.0, entry_conviction=0.69,
        pnl=(625.40 - 578.00), pnl_pct=(625.40 / 578.00 - 1), hold_days=28,
        entry_decision_ref="",
    ),
    # Win — moderate conviction — AMZN
    ClosedTrade(
        ticker="AMZN", entry_price=218.00, exit_price=227.85,
        entry_date=_dt("2025-06-02"), exit_date=_dt("2025-06-30"),
        shares=1.0, entry_conviction=0.61,
        pnl=(227.85 - 218.00), pnl_pct=(227.85 / 218.00 - 1), hold_days=28,
        entry_decision_ref="",
    ),
    # Win — high conviction — MSFT Q3
    ClosedTrade(
        ticker="MSFT", entry_price=437.80, exit_price=468.20,
        entry_date=_dt("2025-07-07"), exit_date=_dt("2025-08-04"),
        shares=1.0, entry_conviction=0.70,
        pnl=(468.20 - 437.80), pnl_pct=(468.20 / 437.80 - 1), hold_days=28,
        entry_decision_ref="",
    ),
    # Win — moderate conviction — NVDA recovery
    ClosedTrade(
        ticker="NVDA", entry_price=108.50, exit_price=131.20,
        entry_date=_dt("2025-08-04"), exit_date=_dt("2025-09-01"),
        shares=1.0, entry_conviction=0.65,
        pnl=(131.20 - 108.50), pnl_pct=(131.20 / 108.50 - 1), hold_days=28,
        entry_decision_ref="",
    ),
]


def main() -> None:
    print(f"\nBuilding synthetic 10-trade AICOS history...")
    print(f"Fetching SPY and QQQ prices for trade periods (real yfinance call)...")

    report = generate_from_trades(
        SYNTHETIC_TRADES,
        as_of=_dt("2025-09-05"),
        risk_free_annual=0.05,
        rolling_window=5,   # use window=5 so rolling Sharpe appears with 10 trades
    )

    print(format_report(report))

    # Spot-check key metrics
    m = report.aicos
    assert m.num_trades == 10,     f"Expected 10 trades, got {m.num_trades}"
    assert m.num_wins == 8,        f"Expected 8 wins, got {m.num_wins}"
    assert m.num_losses == 2,      f"Expected 2 losses, got {m.num_losses}"
    assert abs(m.win_rate - 0.8) < 0.01, f"Expected 80% win rate, got {m.win_rate:.1%}"
    assert m.sharpe_ratio is not None, "Sharpe should be computed for 10 trades"
    assert m.max_drawdown_pct >= 0,    "Max drawdown should be non-negative"

    # Conviction edge: winners should have higher avg conviction than losers
    if m.avg_conviction_wins and m.avg_conviction_losses:
        assert m.avg_conviction_wins > m.avg_conviction_losses, (
            f"Expected conviction higher on wins ({m.avg_conviction_wins:.1%}) "
            f"than losses ({m.avg_conviction_losses:.1%})"
        )
        print(f"Conviction edge confirmed: "
              f"wins {m.avg_conviction_wins:.1%} vs losses {m.avg_conviction_losses:.1%}")

    assert len(m.rolling_sharpe) >= 1, "Should have rolling Sharpe with window=5 and 10 trades"

    print(f"\nAll assertions passed.")


if __name__ == "__main__":
    main()
