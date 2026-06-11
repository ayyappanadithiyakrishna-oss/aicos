"""
Performance metrics for AICOS closed-trade history.

All metrics are trade-level (not daily mark-to-market) because AICOS is a
low-frequency system.  Rolling Sharpe uses a sliding window of N completed
trades rather than a calendar window, which is more meaningful than an
N-day window with mostly-zero returns for a system that holds positions
for days to weeks at a time.
"""

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ClosedTrade:
    ticker: str
    entry_price: float
    exit_price: float
    entry_date: datetime
    exit_date: datetime
    shares: float
    entry_conviction: float   # committee confidence [0–1] at entry
    pnl: float                # absolute P&L in dollars
    pnl_pct: float            # (exit - entry) / entry
    hold_days: int
    entry_decision_ref: str = ""


@dataclass
class RollingSharpePt:
    date: datetime
    sharpe: float
    window_trades: int


@dataclass
class PerformanceMetrics:
    total_pnl: float
    total_return_pct: float                  # sum(pnl) / sum(cost_basis) × 100
    annualized_return_pct: float | None      # None if < 30 days of history
    sharpe_ratio: float | None               # None if < 2 closed trades
    max_drawdown_pct: float                  # % peak-to-trough on equity curve
    win_rate: float                          # fraction of trades with pnl > 0
    num_trades: int
    num_wins: int
    num_losses: int
    avg_hold_days: float
    avg_conviction_wins: float | None        # mean entry conviction on winning trades
    avg_conviction_losses: float | None      # mean entry conviction on losing trades
    rolling_sharpe: list[RollingSharpePt] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _trade_sharpe(
    returns: list[float],
    avg_hold_days: float,
    risk_free_annual: float,
) -> float | None:
    """Annualised Sharpe from a list of per-trade returns.

    Annualisation factor = sqrt(estimated trades per year), where
    trades_per_year = 252 / avg_hold_days.  This is the standard
    approach for performance attribution on a trade-frequency basis.
    """
    n = len(returns)
    if n < 2:
        return None
    mean = sum(returns) / n
    variance = sum((r - mean) ** 2 for r in returns) / (n - 1)
    std = math.sqrt(variance) if variance > 0 else 0.0
    if std == 0.0:
        return None
    hold = max(avg_hold_days, 1.0)
    risk_free_per_trade = (1.0 + risk_free_annual) ** (hold / 252.0) - 1.0
    trades_per_year = 252.0 / hold
    return (mean - risk_free_per_trade) / std * math.sqrt(trades_per_year)


def _max_drawdown(equity_curve: list[float]) -> float:
    """Peak-to-trough maximum drawdown on a normalised equity curve."""
    if len(equity_curve) < 2:
        return 0.0
    peak = equity_curve[0]
    max_dd = 0.0
    for v in equity_curve:
        if v > peak:
            peak = v
        dd = (peak - v) / peak if peak > 0 else 0.0
        if dd > max_dd:
            max_dd = dd
    return max_dd


def _equity_curve(trades: list[ClosedTrade]) -> list[float]:
    """Build a sequential compounding equity curve normalised to 1.0 at start."""
    curve = [1.0]
    equity = 1.0
    for t in trades:
        equity *= 1.0 + t.pnl_pct
        curve.append(equity)
    return curve


def _empty_metrics() -> PerformanceMetrics:
    return PerformanceMetrics(
        total_pnl=0.0,
        total_return_pct=0.0,
        annualized_return_pct=None,
        sharpe_ratio=None,
        max_drawdown_pct=0.0,
        win_rate=0.0,
        num_trades=0,
        num_wins=0,
        num_losses=0,
        avg_hold_days=0.0,
        avg_conviction_wins=None,
        avg_conviction_losses=None,
        rolling_sharpe=[],
    )


def _build_closed_trades(
    txs: list[Any],
    decisions_by_ts: dict[str, dict],
) -> list["ClosedTrade"]:
    """Match buy/sell transactions FIFO per ticker and attach entry conviction."""
    by_ticker: dict[str, list[Any]] = defaultdict(list)
    for tx in sorted(txs, key=lambda t: t.timestamp):
        by_ticker[tx.ticker].append(tx)

    closed: list[ClosedTrade] = []
    for ticker, ticker_txs in by_ticker.items():
        buy_queue: list[tuple[Any, float]] = []
        for tx in ticker_txs:
            if tx.action == "buy":
                decision = decisions_by_ts.get(tx.decision_ref, {})
                conviction = float(decision.get("confidence", 0.0))
                buy_queue.append((tx, conviction))
            elif tx.action == "sell" and buy_queue:
                buy_tx, entry_conviction = buy_queue.pop(0)
                pnl = (tx.price - buy_tx.price) * buy_tx.shares
                pnl_pct = (tx.price / buy_tx.price - 1.0) if buy_tx.price else 0.0
                entry_dt = _parse_dt(buy_tx.timestamp)
                exit_dt = _parse_dt(tx.timestamp)
                hold_days = max((exit_dt - entry_dt).days, 0)
                closed.append(ClosedTrade(
                    ticker=ticker,
                    entry_price=buy_tx.price,
                    exit_price=tx.price,
                    entry_date=entry_dt,
                    exit_date=exit_dt,
                    shares=buy_tx.shares,
                    entry_conviction=entry_conviction,
                    pnl=pnl,
                    pnl_pct=pnl_pct,
                    hold_days=hold_days,
                    entry_decision_ref=buy_tx.decision_ref,
                ))
    return sorted(closed, key=lambda t: t.entry_date)


def _parse_dt(ts: str) -> datetime:
    dt = datetime.fromisoformat(ts)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class PerformanceTracker:
    def __init__(
        self,
        closed_trades: list[ClosedTrade],
        risk_free_annual: float = 0.05,
        rolling_window: int = 20,
    ):
        self.trades = sorted(closed_trades, key=lambda t: t.entry_date)
        self.risk_free = risk_free_annual
        self.rolling_window = rolling_window

    @classmethod
    def from_ledger(
        cls,
        tx_store: Any,
        decision_store: Any,
        risk_free_annual: float = 0.05,
        rolling_window: int = 20,
    ) -> "PerformanceTracker":
        txs = tx_store.load_all()
        decisions = {d["timestamp"]: d for d in decision_store.load_all()}
        trades = _build_closed_trades(txs, decisions)
        return cls(trades, risk_free_annual, rolling_window)

    def compute(self) -> PerformanceMetrics:
        trades = self.trades
        n = len(trades)
        if n == 0:
            return _empty_metrics()

        # P&L and return
        total_pnl = sum(t.pnl for t in trades)
        total_cost = sum(t.entry_price * t.shares for t in trades)
        total_return_pct = (total_pnl / total_cost * 100.0) if total_cost else 0.0

        # Win / loss split
        wins = [t for t in trades if t.pnl > 0.0]
        losses = [t for t in trades if t.pnl <= 0.0]
        win_rate = len(wins) / n

        # Hold days
        avg_hold = sum(t.hold_days for t in trades) / n

        # Sharpe (trade-level, annualised)
        returns = [t.pnl_pct for t in trades]
        sharpe = _trade_sharpe(returns, avg_hold, self.risk_free)

        # Equity curve + max drawdown
        curve = _equity_curve(trades)
        max_dd = _max_drawdown(curve) * 100.0

        # Annualised return (needs ≥ 30 days of history)
        first_dt = trades[0].entry_date
        last_dt = trades[-1].exit_date
        history_days = max((last_dt - first_dt).days, 1)
        if history_days >= 30:
            years = history_days / 365.25
            ann_return = ((curve[-1]) ** (1.0 / years) - 1.0) * 100.0
        else:
            ann_return = None

        # Conviction analysis
        def _avg(vals: list[float]) -> float | None:
            return sum(vals) / len(vals) if vals else None

        win_convictions = [t.entry_conviction for t in wins if t.entry_conviction > 0]
        loss_convictions = [t.entry_conviction for t in losses if t.entry_conviction > 0]

        # Rolling Sharpe (N-trade sliding window)
        rolling: list[RollingSharpePt] = []
        w = self.rolling_window
        if n >= w:
            for i in range(w, n + 1):
                window_trades = trades[i - w: i]
                w_returns = [t.pnl_pct for t in window_trades]
                w_hold = sum(t.hold_days for t in window_trades) / w
                s = _trade_sharpe(w_returns, w_hold, self.risk_free)
                if s is not None:
                    rolling.append(RollingSharpePt(
                        date=window_trades[-1].exit_date,
                        sharpe=s,
                        window_trades=w,
                    ))

        return PerformanceMetrics(
            total_pnl=total_pnl,
            total_return_pct=total_return_pct,
            annualized_return_pct=ann_return,
            sharpe_ratio=sharpe,
            max_drawdown_pct=max_dd,
            win_rate=win_rate,
            num_trades=n,
            num_wins=len(wins),
            num_losses=len(losses),
            avg_hold_days=avg_hold,
            avg_conviction_wins=_avg(win_convictions),
            avg_conviction_losses=_avg(loss_convictions),
            rolling_sharpe=rolling,
        )


# Keep the module-level functions the original stubs expected so imports don't break.
def compute_sharpe(returns: list[float], risk_free: float = 0.05) -> float:
    """Daily-returns Sharpe, annualised. Kept for backward compatibility."""
    n = len(returns)
    if n < 2:
        return 0.0
    mean = sum(returns) / n
    variance = sum((r - mean) ** 2 for r in returns) / (n - 1)
    std = math.sqrt(variance) if variance > 0 else 0.0
    daily_rf = risk_free / 252
    return ((mean - daily_rf) / std * math.sqrt(252)) if std else 0.0


def compute_max_drawdown(equity_curve: list[float]) -> float:
    """Backward-compatible module-level function."""
    return _max_drawdown(equity_curve)
