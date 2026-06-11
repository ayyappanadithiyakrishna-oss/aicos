"""
Weekly performance summary report.

Loads closed trades from the ledger, computes AICOS metrics, mirrors each
trade against SPY and QQQ, then formats a printable comparison report.
"""

from __future__ import annotations

import textwrap
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from benchmarks.metrics.performance import (
    ClosedTrade,
    PerformanceMetrics,
    PerformanceTracker,
)
from benchmarks.strategies.buy_and_hold import BenchmarkResult, BuyAndHoldBenchmark

W = 72  # report width


# ---------------------------------------------------------------------------
# Report structure
# ---------------------------------------------------------------------------

@dataclass
class WeeklyReport:
    generated_at: datetime
    week_start: datetime
    week_end: datetime
    all_time_trades: int
    week_trades: int             # closed trades that exited in this calendar week
    aicos: PerformanceMetrics
    spy: BenchmarkResult
    qqq: BenchmarkResult
    recent_closed: list[ClosedTrade]   # last 5 closed trades for the trade log


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def generate(
    tx_store: Any,
    decision_store: Any,
    as_of: datetime | None = None,
    risk_free_annual: float = 0.05,
    rolling_window: int = 20,
) -> WeeklyReport:
    """Build a WeeklyReport from live ledger data.

    as_of defaults to now (UTC).  The "week" is the 7-day window ending at as_of.
    """
    now = as_of or datetime.now(tz=timezone.utc)
    week_start = now - timedelta(days=7)

    tracker = PerformanceTracker.from_ledger(
        tx_store, decision_store, risk_free_annual, rolling_window
    )
    metrics = tracker.compute()

    all_trades = tracker.trades
    week_trades = [t for t in all_trades if t.exit_date >= week_start]

    spy_result = BuyAndHoldBenchmark("SPY", risk_free_annual).run(all_trades)
    qqq_result = BuyAndHoldBenchmark("QQQ", risk_free_annual).run(all_trades)

    return WeeklyReport(
        generated_at=now,
        week_start=week_start,
        week_end=now,
        all_time_trades=len(all_trades),
        week_trades=len(week_trades),
        aicos=metrics,
        spy=spy_result,
        qqq=qqq_result,
        recent_closed=all_trades[-5:],
    )


def generate_from_trades(
    closed_trades: list[ClosedTrade],
    as_of: datetime | None = None,
    risk_free_annual: float = 0.05,
    rolling_window: int = 20,
) -> WeeklyReport:
    """Build a WeeklyReport directly from a list of ClosedTrade objects.

    Used in tests and when bypassing the ledger.
    """
    now = as_of or datetime.now(tz=timezone.utc)
    week_start = now - timedelta(days=7)

    tracker = PerformanceTracker(closed_trades, risk_free_annual, rolling_window)
    metrics = tracker.compute()

    week_trades = [t for t in closed_trades if t.exit_date >= week_start]

    spy_result = BuyAndHoldBenchmark("SPY", risk_free_annual).run(closed_trades)
    qqq_result = BuyAndHoldBenchmark("QQQ", risk_free_annual).run(closed_trades)

    return WeeklyReport(
        generated_at=now,
        week_start=week_start,
        week_end=now,
        all_time_trades=len(closed_trades),
        week_trades=len(week_trades),
        aicos=metrics,
        spy=spy_result,
        qqq=qqq_result,
        recent_closed=closed_trades[-5:],
    )


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def format_report(report: WeeklyReport) -> str:
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

    def row(label: str, value: str, indent: int = 4) -> None:
        pad = " " * indent
        line(f"{pad}{label:<34}{value}")

    def _fmt_pct(v: float | None, suffix: str = "%", signed: bool = True) -> str:
        if v is None:
            return "n/a"
        sign = "+" if (signed and v > 0) else ""
        return f"{sign}{v:.2f}{suffix}"

    def _fmt_float(v: float | None, decimals: int = 2) -> str:
        return "n/a" if v is None else f"{v:.{decimals}f}"

    def _fmt_conviction(v: float | None) -> str:
        return "n/a" if v is None else f"{v:.1%}"

    def _delta(aicos_val: float | None, bm_val: float | None) -> str:
        if aicos_val is None or bm_val is None:
            return "n/a"
        d = aicos_val - bm_val
        sign = "+" if d >= 0 else ""
        return f"{sign}{d:.2f} pp  ({'AICOS leads' if d > 0 else 'benchmark leads'})"

    # ── Title ────────────────────────────────────────────────────────────
    header(
        f"AICOS Weekly Performance Report\n"
        f"  Week of {report.week_start.strftime('%Y-%m-%d')} "
        f"→ {report.week_end.strftime('%Y-%m-%d %H:%M UTC')}\n"
        f"  Generated: {report.generated_at.strftime('%Y-%m-%d %H:%M UTC')}"
    )

    a = report.aicos

    # ── AICOS overview ────────────────────────────────────────────────────
    section("AICOS Performance (all-time, closed trades only)")
    row("Closed trades", f"{a.num_trades}  (this week: {report.week_trades})")
    row("Total P&L", f"${a.total_pnl:+.2f}")
    row("Total return", _fmt_pct(a.total_return_pct))
    row("Annualised return", _fmt_pct(a.annualized_return_pct)
        + ("" if a.annualized_return_pct is not None else "  (< 30 days history)"))
    row("Sharpe ratio", _fmt_float(a.sharpe_ratio)
        + ("" if a.sharpe_ratio is not None else "  (need ≥ 2 closed trades)"))
    row("Max drawdown", _fmt_pct(a.max_drawdown_pct, signed=False))
    row("Win rate",
        f"{a.win_rate:.1%}  ({a.num_wins}W / {a.num_losses}L)")
    row("Avg hold (days)", _fmt_float(a.avg_hold_days, 1))
    line()
    row("Avg conviction — winning trades", _fmt_conviction(a.avg_conviction_wins))
    row("Avg conviction — losing trades",  _fmt_conviction(a.avg_conviction_losses))
    if a.avg_conviction_wins and a.avg_conviction_losses:
        delta = a.avg_conviction_wins - a.avg_conviction_losses
        row("  conviction edge",
            f"{delta:+.1%}  ({'higher on winners ✓' if delta > 0 else 'higher on losers ✗'})")

    # Rolling Sharpe (last 3 data points)
    if a.rolling_sharpe:
        line()
        row(f"Rolling Sharpe ({a.rolling_sharpe[0].window_trades}-trade window)", "")
        for pt in a.rolling_sharpe[-3:]:
            row(f"  {pt.date.strftime('%Y-%m-%d')}", f"{pt.sharpe:.2f}", indent=4)
    else:
        line()
        row(f"Rolling Sharpe",
            f"n/a  (need ≥ {20} closed trades)")

    # ── SPY benchmark ─────────────────────────────────────────────────────
    s = report.spy
    section(f"SPY Benchmark (same entry/exit dates as AICOS)")
    row("Matched trades",
        f"{s.num_trades}"
        + (f"  ({s.unmatched_trades} unmatched — price data unavailable)"
           if s.unmatched_trades else ""))
    row("Total return", _fmt_pct(s.total_return_pct))
    row("Sharpe ratio", _fmt_float(s.sharpe_ratio))
    row("Max drawdown", _fmt_pct(s.max_drawdown_pct, signed=False))
    row("Win rate", f"{s.win_rate:.1%}  ({sum(1 for t in s.trades if t.pnl > 0)}W / "
        f"{sum(1 for t in s.trades if t.pnl <= 0)}L)")
    row("Avg hold (days)", _fmt_float(s.avg_hold_days, 1))

    # ── QQQ benchmark ─────────────────────────────────────────────────────
    q = report.qqq
    section(f"QQQ Benchmark (same entry/exit dates as AICOS)")
    row("Matched trades",
        f"{q.num_trades}"
        + (f"  ({q.unmatched_trades} unmatched)"
           if q.unmatched_trades else ""))
    row("Total return", _fmt_pct(q.total_return_pct))
    row("Sharpe ratio", _fmt_float(q.sharpe_ratio))
    row("Max drawdown", _fmt_pct(q.max_drawdown_pct, signed=False))
    row("Win rate", f"{q.win_rate:.1%}  ({sum(1 for t in q.trades if t.pnl > 0)}W / "
        f"{sum(1 for t in q.trades if t.pnl <= 0)}L)")
    row("Avg hold (days)", _fmt_float(q.avg_hold_days, 1))

    # ── vs. benchmark comparison ──────────────────────────────────────────
    section("AICOS vs Benchmarks")
    row("Return vs SPY",   _delta(a.total_return_pct, s.total_return_pct))
    row("Return vs QQQ",   _delta(a.total_return_pct, q.total_return_pct))
    row("Sharpe vs SPY",   _delta(a.sharpe_ratio, s.sharpe_ratio))
    row("Sharpe vs QQQ",   _delta(a.sharpe_ratio, q.sharpe_ratio))
    row("Drawdown vs SPY", _delta(s.max_drawdown_pct, a.max_drawdown_pct)
        .replace("AICOS leads", "AICOS shallower ✓").replace("benchmark leads", "SPY shallower"))
    row("Drawdown vs QQQ", _delta(q.max_drawdown_pct, a.max_drawdown_pct)
        .replace("AICOS leads", "AICOS shallower ✓").replace("benchmark leads", "QQQ shallower"))

    # ── Recent closed trades ──────────────────────────────────────────────
    if report.recent_closed:
        section(f"Recent Closed Trades (last {len(report.recent_closed)})")
        line(f"    {'Ticker':<8} {'Entry':>10} {'Exit':>10} "
             f"{'Return':>8} {'Hold':>6} {'Conviction':>11}")
        line(f"    {'─' * 8} {'─' * 10} {'─' * 10} "
             f"{'─' * 8} {'─' * 6} {'─' * 11}")
        for t in report.recent_closed:
            sign = "+" if t.pnl_pct >= 0 else ""
            line(
                f"    {t.ticker:<8} "
                f"{t.entry_date.strftime('%Y-%m-%d'):>10} "
                f"{t.exit_date.strftime('%Y-%m-%d'):>10} "
                f"{sign}{t.pnl_pct:.2%}  "
                f"{t.hold_days:>4}d "
                f"  {t.entry_conviction:.1%}"
            )

    line()
    line("═" * W)
    line()

    return "\n".join(lines)
