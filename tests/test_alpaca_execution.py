"""Alpaca execution tests — fully mocked, no network calls."""

import tempfile
from pathlib import Path
from unittest.mock import MagicMock

from agents.base import AgentContext, AgentOutput, BaseAgent
from config.settings import CommitteeConfig, Settings
from ledger.decisions.store import DecisionStore
from ledger.positions.store import PositionStore
from ledger.transactions.store import TransactionStore
from orchestrator.committee.session import CommitteeSession
from orchestrator.execution.alpaca_client import AlpacaPaperClient, OrderResult
from orchestrator.workflows.investment_review import InvestmentReviewWorkflow

AAPL_DATA = {"price": 200.0}


class _BuyAgent(BaseAgent):
    def __init__(self, agent_id: str) -> None:
        super().__init__(agent_id)

    def name(self) -> str:
        return f"Buy-{self.agent_id}"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="buy",
            conviction=0.85,
            rationale="Strong buy.",
            metadata={"round": 1, "vote": 7, "confidence": 85, "agent_name": self.agent_id},
        )


class _ReduceAgent(BaseAgent):
    def __init__(self, agent_id: str) -> None:
        super().__init__(agent_id)

    def name(self) -> str:
        return f"Reduce-{self.agent_id}"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="reduce",
            conviction=0.90,
            rationale="Reduce always.",
            metadata={"round": 1, "vote": 2, "confidence": 90, "agent_name": self.agent_id},
        )


def _build_stores(tmp: Path):
    return (
        DecisionStore(tmp / "decisions" / "history.jsonl"),
        PositionStore(tmp / "positions" / "positions.json"),
        TransactionStore(tmp / "transactions" / "transactions.jsonl"),
    )


def _mock_alpaca(
    filled_qty: float = 10.0,
    filled_avg_price: float = 201.50,
    filled_at: str = "2025-07-14T12:00:00+00:00",
    order_id: str = "mock-order-001",
    side_effect: Exception | None = None,
) -> AlpacaPaperClient:
    client = MagicMock(spec=AlpacaPaperClient)
    if side_effect is not None:
        client.submit_order.side_effect = side_effect
    else:
        client.submit_order.return_value = OrderResult(
            order_id=order_id,
            ticker="AAPL",
            side="buy",
            notional=2000.0,
            qty=filled_qty,
            order_type="market",
            status="filled",
            filled_qty=filled_qty,
            filled_avg_price=filled_avg_price,
            filled_at=filled_at,
        )
    return client


def _build_workflow_with_alpaca(agents, stores, alpaca, threshold=0.55):
    session = CommitteeSession(agents=agents)
    ds, ps, ts = stores
    settings = Settings(committee=CommitteeConfig(conviction_threshold=threshold))
    return InvestmentReviewWorkflow(
        session=session,
        decision_store=ds,
        position_store=ps,
        transaction_store=ts,
        settings=settings,
        alpaca=alpaca,
    )


def _buy_agents():
    return [_BuyAgent(f"bull_{i}") for i in range(1, 6)]


def _reduce_agents():
    return [_ReduceAgent(f"reduce_{i}") for i in range(1, 6)]


# ---------------------------------------------------------------------------
# Buy: reconciliation uses fill data, not requested data
# ---------------------------------------------------------------------------

def test_buy_reconciles_with_fill_price():
    """Position and transaction use Alpaca's fill price, not the requested price."""
    with tempfile.TemporaryDirectory() as tmpdir:
        stores = _build_stores(Path(tmpdir))
        alpaca = _mock_alpaca(filled_qty=9.95, filled_avg_price=201.00)
        wf = _build_workflow_with_alpaca(_buy_agents(), stores, alpaca)

        result = wf.run("AAPL", data=AAPL_DATA)

        assert result.ledger_action == "opened"
        assert result.order_result is not None
        assert result.order_result.filled_avg_price == 201.00

        # Position uses fill data, not the $200 requested price
        assert result.position is not None
        assert result.position.avg_cost == 201.00
        assert result.position.shares == 9.95

        # Transaction also reflects fill
        assert result.transaction is not None
        assert result.transaction.price == 201.00
        assert result.transaction.shares == 9.95
        assert "Alpaca fill" in result.transaction.notes


def test_buy_position_persisted_to_store():
    """PositionStore contains the reconciled position after a buy."""
    with tempfile.TemporaryDirectory() as tmpdir:
        stores = _build_stores(Path(tmpdir))
        _, ps, _ = stores
        alpaca = _mock_alpaca(filled_qty=5.0, filled_avg_price=199.50)
        wf = _build_workflow_with_alpaca(_buy_agents(), stores, alpaca)

        wf.run("AAPL", data=AAPL_DATA)

        stored = ps.get("AAPL")
        assert stored is not None
        assert stored.avg_cost == 199.50
        assert stored.shares == 5.0
        assert stored.status == "open"


def test_buy_transaction_persisted_to_store():
    """TransactionStore contains the reconciled transaction after a buy."""
    with tempfile.TemporaryDirectory() as tmpdir:
        stores = _build_stores(Path(tmpdir))
        _, _, ts = stores
        alpaca = _mock_alpaca(filled_qty=5.0, filled_avg_price=199.50)
        wf = _build_workflow_with_alpaca(_buy_agents(), stores, alpaca)

        wf.run("AAPL", data=AAPL_DATA)

        txns = ts.load_all()
        assert len(txns) == 1
        assert txns[0].action == "buy"
        assert txns[0].price == 199.50
        assert txns[0].shares == 5.0


def test_buy_alpaca_called_with_correct_args():
    """submit_order is called with the correct ticker, side, and notional."""
    with tempfile.TemporaryDirectory() as tmpdir:
        stores = _build_stores(Path(tmpdir))
        alpaca = _mock_alpaca()
        wf = _build_workflow_with_alpaca(_buy_agents(), stores, alpaca)

        wf.run("AAPL", data=AAPL_DATA)

        alpaca.submit_order.assert_called_once()
        call_kwargs = alpaca.submit_order.call_args
        assert call_kwargs.kwargs["ticker"] == "AAPL"
        assert call_kwargs.kwargs["side"] == "buy"
        assert call_kwargs.kwargs["notional"] > 0


# ---------------------------------------------------------------------------
# Sell: close position via Alpaca
# ---------------------------------------------------------------------------

def test_sell_closes_position_via_alpaca():
    """A reduce signal sells the position through Alpaca and reconciles."""
    with tempfile.TemporaryDirectory() as tmpdir:
        stores = _build_stores(Path(tmpdir))
        ds, ps, ts = stores

        # First open a position (without Alpaca, simpler setup)
        buy_wf = _build_workflow_with_alpaca(_buy_agents(), stores, _mock_alpaca(filled_qty=10.0, filled_avg_price=200.0))
        buy_result = buy_wf.run("AAPL", data=AAPL_DATA)
        assert buy_result.ledger_action == "opened"

        # Now sell via reduce signal with a different fill price
        sell_alpaca = MagicMock(spec=AlpacaPaperClient)
        sell_alpaca.submit_order.return_value = OrderResult(
            order_id="sell-order-001",
            ticker="AAPL",
            side="sell",
            notional=2100.0,
            qty=10.0,
            order_type="market",
            status="filled",
            filled_qty=10.0,
            filled_avg_price=210.00,
            filled_at="2025-07-14T14:00:00+00:00",
        )

        sell_wf = _build_workflow_with_alpaca(_reduce_agents(), stores, sell_alpaca)
        sell_result = sell_wf.run("AAPL", data={"price": 209.00})

        assert sell_result.ledger_action == "closed"
        assert sell_result.order_result is not None
        assert sell_result.order_result.filled_avg_price == 210.00

        # Transaction uses fill price (210), not requested (209)
        assert sell_result.transaction is not None
        assert sell_result.transaction.price == 210.00
        assert sell_result.transaction.action == "sell"
        assert "Alpaca fill" in sell_result.transaction.notes


def test_sell_alpaca_called_with_sell_side():
    """submit_order is called with side='sell' for exit signals."""
    with tempfile.TemporaryDirectory() as tmpdir:
        stores = _build_stores(Path(tmpdir))

        # Open position first
        buy_wf = _build_workflow_with_alpaca(_buy_agents(), stores, _mock_alpaca())
        buy_wf.run("AAPL", data=AAPL_DATA)

        # Sell
        sell_alpaca = MagicMock(spec=AlpacaPaperClient)
        sell_alpaca.submit_order.return_value = OrderResult(
            order_id="sell-002", ticker="AAPL", side="sell",
            notional=2000.0, qty=10.0, order_type="market", status="filled",
            filled_qty=10.0, filled_avg_price=200.0, filled_at="2025-07-14T15:00:00+00:00",
        )
        sell_wf = _build_workflow_with_alpaca(_reduce_agents(), stores, sell_alpaca)
        sell_wf.run("AAPL", data=AAPL_DATA)

        sell_alpaca.submit_order.assert_called_once()
        assert sell_alpaca.submit_order.call_args.kwargs["side"] == "sell"


# ---------------------------------------------------------------------------
# Failure: Alpaca order rejected — ledger must stay clean
# ---------------------------------------------------------------------------

def test_failed_buy_does_not_create_position():
    """When Alpaca rejects a buy, no position is created."""
    with tempfile.TemporaryDirectory() as tmpdir:
        stores = _build_stores(Path(tmpdir))
        _, ps, ts = stores
        alpaca = _mock_alpaca(side_effect=Exception("Insufficient buying power"))
        wf = _build_workflow_with_alpaca(_buy_agents(), stores, alpaca)

        result = wf.run("AAPL", data=AAPL_DATA)

        assert result.ledger_action == "failed"
        assert "Alpaca order rejected" in result.ledger_reasoning
        assert result.position is None
        assert result.transaction is None

        # Nothing in the stores
        assert ps.get("AAPL") is None
        assert ts.load_all() == []


def test_failed_buy_still_records_decision():
    """DecisionStore always gets a record, even on Alpaca failure."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        stores = _build_stores(tmp)
        alpaca = _mock_alpaca(side_effect=Exception("Market closed"))
        wf = _build_workflow_with_alpaca(_buy_agents(), stores, alpaca)

        wf.run("AAPL", data=AAPL_DATA)

        decisions_file = tmp / "decisions" / "history.jsonl"
        lines = [l for l in decisions_file.read_text().splitlines() if l.strip()]
        assert len(lines) == 1


def test_failed_sell_does_not_corrupt_position():
    """When Alpaca rejects a sell, the open position remains untouched."""
    with tempfile.TemporaryDirectory() as tmpdir:
        stores = _build_stores(Path(tmpdir))
        _, ps, ts = stores

        # Open position successfully
        buy_alpaca = _mock_alpaca(filled_qty=10.0, filled_avg_price=200.0)
        buy_wf = _build_workflow_with_alpaca(_buy_agents(), stores, buy_alpaca)
        buy_wf.run("AAPL", data=AAPL_DATA)

        assert ps.get("AAPL").status == "open"
        tx_count_after_buy = len(ts.load_all())

        # Try to sell but Alpaca fails
        sell_alpaca = _mock_alpaca(side_effect=Exception("Connection timeout"))
        sell_wf = _build_workflow_with_alpaca(_reduce_agents(), stores, sell_alpaca)
        sell_result = sell_wf.run("AAPL", data={"price": 210.0})

        assert sell_result.ledger_action == "failed"

        # Position is still open, no new transaction
        pos = ps.get("AAPL")
        assert pos is not None
        assert pos.status == "open"
        assert len(ts.load_all()) == tx_count_after_buy


# ---------------------------------------------------------------------------
# No Alpaca client: workflow behaves exactly as before
# ---------------------------------------------------------------------------

def test_no_alpaca_client_opens_without_execution():
    """Without alpaca kwarg, workflow opens positions locally (no execution)."""
    with tempfile.TemporaryDirectory() as tmpdir:
        stores = _build_stores(Path(tmpdir))
        session = CommitteeSession(agents=_buy_agents())
        ds, ps, ts = stores
        settings = Settings(committee=CommitteeConfig(conviction_threshold=0.55))
        wf = InvestmentReviewWorkflow(
            session=session, decision_store=ds, position_store=ps,
            transaction_store=ts, settings=settings,
        )

        result = wf.run("AAPL", data=AAPL_DATA)

        assert result.ledger_action == "opened"
        assert result.order_result is None
        assert result.position is not None
        assert result.position.avg_cost == 200.0
