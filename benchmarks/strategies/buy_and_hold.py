"""
Buy-and-hold benchmark for SPY and QQQ.

For each AICOS closed trade, we simulate buying the benchmark ticker on the
same entry date and selling it on the same exit date, using the same notional
capital (entry_price × shares).  This gives an apples-to-apples comparison of
what the same capital deployment would have returned in a passive strategy.

Prices are fetched from Yahoo Finance with a ±7-day window to handle weekends
and market holidays.  When prices cannot be fetched for a trade period the
trade is counted as unmatched and excluded from aggregate metrics.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from data.fetcher import DataFetcher

if TYPE_CHECKING:
    from benchmarks.metrics.performance import ClosedTrade

# Module-level DataFetcher singleton so the file cache is shared across calls
# within the same process.  Historical prices are cached indefinitely.
_fetcher = DataFetcher()


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class BenchmarkTrade:
    benchmark_ticker: str
    aicos_ticker: str          # the AICOS ticker this mirrors
    entry_date: datetime
    exit_date: datetime
    entry_price: float
    exit_price: float
    shares: float              # normalised so notional = AICOS entry notional
    pnl: float
    pnl_pct: float
    hold_days: int


@dataclass
class BenchmarkResult:
    ticker: str                          # "SPY" or "QQQ"
    trades: list[BenchmarkTrade]
    total_return_pct: float              # same cost-basis denominator as AICOS
    sharpe_ratio: float | None
    max_drawdown_pct: float
    win_rate: float
    num_trades: int                      # matched trades only
    avg_hold_days: float
    unmatched_trades: int                # trades skipped due to missing price data


# ---------------------------------------------------------------------------
# Price lookup — routed through the centralised DataFetcher
# ---------------------------------------------------------------------------

def _fetch_price(ticker: str, target_date: datetime) -> float | None:
    """Return closing price on or before target_date.

    Delegates to DataFetcher.fetch_historical_price() so that all yfinance
    calls go through the central pipeline and are cached under data/cache/.
    """
    return _fetcher.fetch_historical_price(ticker, target_date)


def _trade_sharpe(returns: list[float], avg_hold_days: float, rf: float = 0.05) -> float | None:
    n = len(returns)
    if n < 2:
        return None
    mean = sum(returns) / n
    variance = sum((r - mean) ** 2 for r in returns) / (n - 1)
    std = math.sqrt(variance) if variance > 0 else 0.0
    if std == 0:
        return None
    hold = max(avg_hold_days, 1.0)
    rf_per_trade = (1.0 + rf) ** (hold / 252.0) - 1.0
    trades_per_year = 252.0 / hold
    return (mean - rf_per_trade) / std * math.sqrt(trades_per_year)


def _max_drawdown(equity_curve: list[float]) -> float:
    if len(equity_curve) < 2:
        return 0.0
    peak, max_dd = equity_curve[0], 0.0
    for v in equity_curve:
        peak = max(peak, v)
        dd = (peak - v) / peak if peak > 0 else 0.0
        max_dd = max(max_dd, dd)
    return max_dd


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class BuyAndHoldBenchmark:
    def __init__(self, ticker: str, risk_free_annual: float = 0.05):
        self.ticker = ticker
        self.risk_free = risk_free_annual

    def run(self, closed_trades: list["ClosedTrade"]) -> BenchmarkResult:
        """Mirror each AICOS closed trade in the benchmark ticker."""
        matched: list[BenchmarkTrade] = []
        unmatched = 0

        for ct in closed_trades:
            entry_price = _fetch_price(self.ticker, ct.entry_date)
            exit_price = _fetch_price(self.ticker, ct.exit_date)

            if entry_price is None or exit_price is None or entry_price == 0:
                unmatched += 1
                continue

            # Normalise shares so the notional matches the AICOS entry notional
            aicos_notional = ct.entry_price * ct.shares
            bm_shares = aicos_notional / entry_price

            pnl_pct = (exit_price / entry_price) - 1.0
            pnl = pnl_pct * aicos_notional

            matched.append(BenchmarkTrade(
                benchmark_ticker=self.ticker,
                aicos_ticker=ct.ticker,
                entry_date=ct.entry_date,
                exit_date=ct.exit_date,
                entry_price=entry_price,
                exit_price=exit_price,
                shares=bm_shares,
                pnl=pnl,
                pnl_pct=pnl_pct,
                hold_days=ct.hold_days,
            ))

        if not matched:
            return BenchmarkResult(
                ticker=self.ticker,
                trades=[],
                total_return_pct=0.0,
                sharpe_ratio=None,
                max_drawdown_pct=0.0,
                win_rate=0.0,
                num_trades=0,
                avg_hold_days=0.0,
                unmatched_trades=unmatched,
            )

        n = len(matched)
        total_cost = sum(ct.entry_price * ct.shares for ct in closed_trades
                         if any(m.aicos_ticker == ct.ticker and m.entry_date == ct.entry_date
                                for m in matched))
        total_pnl = sum(m.pnl for m in matched)
        # Use the same cost-basis denominator as AICOS for a fair comparison
        aicos_costs = [ct.entry_price * ct.shares for ct in closed_trades]
        total_aicos_cost = sum(aicos_costs) if aicos_costs else 1.0
        total_return_pct = (total_pnl / total_aicos_cost) * 100.0

        returns = [m.pnl_pct for m in matched]
        avg_hold = sum(m.hold_days for m in matched) / n
        wins = sum(1 for m in matched if m.pnl > 0)

        # Equity curve for drawdown
        curve = [1.0]
        eq = 1.0
        for m in matched:
            eq *= (1.0 + m.pnl_pct)
            curve.append(eq)

        return BenchmarkResult(
            ticker=self.ticker,
            trades=matched,
            total_return_pct=total_return_pct,
            sharpe_ratio=_trade_sharpe(returns, avg_hold, self.risk_free),
            max_drawdown_pct=_max_drawdown(curve) * 100.0,
            win_rate=wins / n,
            num_trades=n,
            avg_hold_days=avg_hold,
            unmatched_trades=unmatched,
        )
