import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from agents.base import AgentContext
from config.settings import Settings
from ledger.decisions.store import DecisionStore
from ledger.positions.store import Position, PositionStore
from ledger.transactions.store import Transaction, TransactionStore
from orchestrator.committee.session import CommitteeResult, CommitteeSession
from orchestrator.sizing.sizer import PositionSizer, SizeResult

if TYPE_CHECKING:
    from data.fetcher import DataFetcher, TickerData

# Signals that should open a position (when above threshold and no position held).
_BUY_SIGNALS = {"buy"}

# Signals that should close an existing open position (when above threshold).
_EXIT_SIGNALS = {"sell", "reduce", "avoid"}


@dataclass
class WorkflowResult:
    committee_result: CommitteeResult
    ledger_action: str        # "opened" | "closed" | "passed" | "hold"
    ledger_reasoning: str
    position: Position | None = None
    transaction: Transaction | None = None
    size_result: SizeResult | None = None   # populated on BUY; None otherwise
    ticker_data: "TickerData | None" = None  # raw pipeline data; None when fetcher not wired


class InvestmentReviewWorkflow:
    def __init__(
        self,
        session: CommitteeSession,
        decision_store: DecisionStore,
        position_store: PositionStore,
        transaction_store: TransactionStore,
        settings: Settings | None = None,
        fetcher: "DataFetcher | None" = None,
    ):
        self.session = session
        self.decision_store = decision_store
        self.position_store = position_store
        self.transaction_store = transaction_store
        self.settings = settings or Settings()
        self._sizer = PositionSizer()
        self._fetcher = fetcher  # when set, auto-populates AgentContext from the pipeline

    def run(
        self,
        ticker: str,
        timeframe: str = "12 months",
        data: dict | None = None,
    ) -> WorkflowResult:
        # ── Populate data from the pipeline when no caller-supplied data ────
        ticker_data = None
        if self._fetcher is not None and not data:
            ticker_data = self._fetcher.fetch(ticker)
            data = ticker_data.to_agent_dict()
            ctx = AgentContext(
                ticker=ticker,
                timeframe=timeframe,
                data=data,
                data_limited=ticker_data.data_quality.is_data_limited,
                data_warnings=ticker_data.data_quality.warnings,
            )
        else:
            data = data or {}
            ctx = AgentContext(ticker=ticker, timeframe=timeframe, data=data)

        # ── Round 1 / 2 / 3 debate ──────────────────────────────────────────
        result = self.session.convene(ctx)

        # ── Determine ledger action ──────────────────────────────────────────
        price = self._extract_price(data)
        action, reasoning, position, tx, size_result = self._evaluate(result, price)

        # ── Persist: decision first (append-only), then position, then tx ───
        self.decision_store.record(
            result,
            ledger_action=action,
            ledger_reasoning=reasoning,
        )
        if position is not None:
            self.position_store.upsert(position)
        if tx is not None:
            self.transaction_store.record(tx)

        return WorkflowResult(
            committee_result=result,
            ledger_action=action,
            ledger_reasoning=reasoning,
            position=position,
            transaction=tx,
            size_result=size_result,
            ticker_data=ticker_data,
        )

    # ── Threshold + sizing logic ─────────────────────────────────────────────

    def _evaluate(
        self,
        result: CommitteeResult,
        price: float | None,
    ) -> tuple[str, str, Position | None, Transaction | None, SizeResult | None]:
        """Return (action, reasoning, position_or_None, transaction_or_None, size_result_or_None)."""
        threshold = self.settings.committee.conviction_threshold
        confidence = result.confidence
        signal = result.final_signal
        ticker = result.ticker
        ts = result.timestamp.astimezone(timezone.utc).isoformat()

        # ── Below threshold ──────────────────────────────────────────────────
        if confidence < threshold:
            dissent_ids = ", ".join(d.agent_id for d in result.dissents)
            reasoning = (
                f"PASS — confidence {confidence:.1%} below threshold {threshold:.1%}. "
                f"Signal: {signal.upper()}. "
                f"Dissenters: {dissent_ids or 'none'}. "
                f"No position action taken."
            )
            return "passed", reasoning, None, None, None

        # ── Buy signal: open position if not already held ────────────────────
        if signal in _BUY_SIGNALS:
            existing = self.position_store.get(ticker)
            if existing and existing.status == "open":
                reasoning = (
                    f"HOLD — confidence {confidence:.1%} ≥ threshold {threshold:.1%}, "
                    f"signal {signal.upper()}, but position already open "
                    f"({existing.shares:.4f} shares @ ${existing.avg_cost:.2f}). "
                    f"No duplicate position opened."
                )
                return "hold", reasoning, None, None, None

            if price is None:
                reasoning = (
                    f"PASS — confidence {confidence:.1%} ≥ threshold {threshold:.1%}, "
                    f"signal {signal.upper()}, but no price available in context data. "
                    f"Cannot open position without a price."
                )
                return "passed", reasoning, None, None, None

            # ── Conviction-based position sizing ────────────────────────────
            portfolio_value = self._current_portfolio_value()
            size = self._sizer.compute(
                confidence, price, portfolio_value, self.settings.portfolio
            )

            position = Position(
                ticker=ticker,
                shares=size.shares,
                avg_cost=price,
                opened_at=ts,
                status="open",
                target_notional=size.notional,
                size_pct=size.pct_of_portfolio,
                size_tier=size.tier_label,
            )
            tx = Transaction(
                id=_new_tx_id(ticker, "buy"),
                ticker=ticker,
                action="buy",
                shares=size.shares,
                price=price,
                timestamp=ts,
                decision_ref=result.timestamp.isoformat(),
                notes=(
                    f"Opened by committee: confidence {confidence:.1%} ≥ {threshold:.1%}. "
                    f"Signal {signal.upper()}. "
                    f"Sizing: {size.reasoning} "
                    f"Majority: {', '.join(v.agent_id for v in result.votes)}."
                ),
            )
            reasoning = (
                f"OPENED — confidence {confidence:.1%} ≥ threshold {threshold:.1%}. "
                f"Signal {signal.upper()}. "
                f"Bought {size.shares:.4f} shares of {ticker} @ ${price:.2f} "
                f"(${size.notional:,.2f} notional, {size.tier_label})."
            )
            return "opened", reasoning, position, tx, size

        # ── Exit signal: close position if one is open ───────────────────────
        if signal in _EXIT_SIGNALS:
            existing = self.position_store.get(ticker)
            if existing is None or existing.status != "open":
                reasoning = (
                    f"HOLD — confidence {confidence:.1%} ≥ threshold {threshold:.1%}, "
                    f"signal {signal.upper()}, but no open position in {ticker} to close."
                )
                return "hold", reasoning, None, None, None

            if price is None:
                reasoning = (
                    f"PASS — confidence {confidence:.1%} ≥ threshold {threshold:.1%}, "
                    f"signal {signal.upper()}, but no price available. "
                    f"Cannot close position without a price."
                )
                return "passed", reasoning, None, None, None

            # Close the position in-place (PositionStore.close mutates + saves)
            closed = self.position_store.close(ticker, ts)
            pnl = (price - existing.avg_cost) * existing.shares
            tx = Transaction(
                id=_new_tx_id(ticker, "sell"),
                ticker=ticker,
                action="sell",
                shares=existing.shares,
                price=price,
                timestamp=ts,
                decision_ref=result.timestamp.isoformat(),
                notes=(
                    f"Closed by committee: confidence {confidence:.1%} ≥ {threshold:.1%}. "
                    f"Signal {signal.upper()}. "
                    f"P&L on close: ${pnl:+.2f} "
                    f"({(price / existing.avg_cost - 1):+.1%}). "
                    f"Dissenters: {', '.join(d.agent_id for d in result.dissents) or 'none'}."
                ),
            )
            reasoning = (
                f"CLOSED — confidence {confidence:.1%} ≥ threshold {threshold:.1%}. "
                f"Signal {signal.upper()}. "
                f"Sold {existing.shares:.4f} share(s) of {ticker} @ ${price:.2f}. "
                f"P&L: ${pnl:+.2f} ({(price / existing.avg_cost - 1):+.1%})."
            )
            return "closed", reasoning, closed, tx, None

        # ── Hold or any other signal ─────────────────────────────────────────
        reasoning = (
            f"HOLD — confidence {confidence:.1%} ≥ threshold {threshold:.1%}, "
            f"signal {signal.upper()}. No position change warranted."
        )
        return "hold", reasoning, None, None, None

    def _current_portfolio_value(self) -> float:
        """Compute current portfolio value in USD.

        Definition: paper_balance adjusted for all realised cash flows.
            cash = paper_balance - sum(buy notionals) + sum(sell notionals)
            open_at_cost = sum(position.avg_cost * position.shares for open positions)
            portfolio_value = cash + open_at_cost
                            = paper_balance + sum(sell_notionals - buy_notionals) + open_at_cost

        This is conservative (no mark-to-market on open positions) but gives a
        stable sizing denominator that doesn't fluctuate with daily price moves.
        """
        paper_balance = self.settings.portfolio.paper_balance

        # Net cash flow from all historical transactions
        cash_flow = 0.0
        for tx in self.transaction_store.load_all():
            notional = tx.price * tx.shares
            if tx.action == "buy":
                cash_flow -= notional
            elif tx.action == "sell":
                cash_flow += notional

        cash = paper_balance + cash_flow

        # Add open positions valued at their entry cost
        open_positions_value = sum(
            p.avg_cost * p.shares for p in self.position_store.all_open()
        )

        return cash + open_positions_value

    @staticmethod
    def _extract_price(data: dict) -> float | None:
        for key in ("price", "last_price", "close", "current_price"):
            v = data.get(key)
            if v is not None:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    continue
        return None


def _new_tx_id(ticker: str, action: str) -> str:
    return f"{ticker}-{action}-{uuid.uuid4().hex[:10]}"
