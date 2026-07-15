"""Ledger integration tests — mock agents, temp directory, no API calls."""

import tempfile
from pathlib import Path

from agents.base import AgentContext, AgentOutput, BaseAgent
from config.settings import CommitteeConfig, Settings
from ledger.decisions.store import DecisionStore
from ledger.positions.store import PositionStore
from ledger.transactions.store import TransactionStore
from orchestrator.committee.session import CommitteeSession
from orchestrator.workflows.investment_review import InvestmentReviewWorkflow
from tests.mocks.agents import (
    MockBearAgent,
    MockBullAgent,
    MockContrarianAgent,
    MockDevilsAdvocateAgent,
    MockFutureLookerAgent,
)

AAPL_DATA = {
    "price": 295.63,
    "market_cap_bn": 4342.0,
    "pe_ratio_trailing": 35.83,
    "revenue_ttm_bn": 391.0,
    "free_cash_flow_bn": 101.1,
}


class MockReduceAgent(BaseAgent):
    def __init__(self, agent_id: str) -> None:
        super().__init__(agent_id)

    def name(self) -> str:
        return f"MockReduce-{self.agent_id}"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="reduce",
            conviction=0.90,
            rationale="Hard reduce — always.",
            metadata={"round": 1, "vote": 2, "confidence": 90, "agent_name": self.agent_id},
        )


def _build_stores(tmp: Path):
    return (
        DecisionStore(tmp / "decisions" / "history.jsonl"),
        PositionStore(tmp / "positions" / "positions.json"),
        TransactionStore(tmp / "transactions" / "transactions.jsonl"),
    )


def _build_workflow(agents, stores, threshold: float) -> InvestmentReviewWorkflow:
    session = CommitteeSession(agents=agents)
    decision_store, position_store, transaction_store = stores
    settings = Settings(committee=CommitteeConfig(conviction_threshold=threshold))
    return InvestmentReviewWorkflow(
        session=session,
        decision_store=decision_store,
        position_store=position_store,
        transaction_store=transaction_store,
        settings=settings,
    )


def _default_agents():
    return [
        MockBearAgent(), MockBullAgent(), MockContrarianAgent(),
        MockDevilsAdvocateAgent(), MockFutureLookerAgent(),
    ]


def test_below_threshold_passes():
    with tempfile.TemporaryDirectory() as tmpdir:
        stores = _build_stores(Path(tmpdir))
        wf = _build_workflow(_default_agents(), stores, threshold=0.65)
        result = wf.run("AAPL", data=AAPL_DATA)
        assert result.ledger_action == "passed"
        assert result.transaction is None


def test_above_threshold_opens_position():
    with tempfile.TemporaryDirectory() as tmpdir:
        stores = _build_stores(Path(tmpdir))
        wf = _build_workflow(_default_agents(), stores, threshold=0.55)
        result = wf.run("AAPL", data=AAPL_DATA)
        assert result.ledger_action == "opened"
        assert result.position is not None
        assert result.position.ticker == "AAPL"
        assert result.position.status == "open"
        assert result.transaction is not None
        assert result.transaction.action == "buy"


def test_reduce_signal_closes_position():
    with tempfile.TemporaryDirectory() as tmpdir:
        stores = _build_stores(Path(tmpdir))

        wf_open = _build_workflow(_default_agents(), stores, threshold=0.55)
        open_result = wf_open.run("AAPL", data=AAPL_DATA)
        assert open_result.ledger_action == "opened"

        reduce_agents = [MockReduceAgent(f"agent_{i}") for i in range(1, 6)]
        wf_close = _build_workflow(reduce_agents, stores, threshold=0.55)
        close_data = {**AAPL_DATA, "price": 312.50}
        close_result = wf_close.run("AAPL", data=close_data)
        assert close_result.ledger_action == "closed"
        assert close_result.position is not None
        assert close_result.position.status == "closed"
        assert close_result.transaction is not None
        assert close_result.transaction.action == "sell"


def test_decision_store_records_all_scenarios():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        stores = _build_stores(tmp)

        wf_a = _build_workflow(_default_agents(), stores, threshold=0.65)
        wf_a.run("AAPL", data=AAPL_DATA)

        wf_b = _build_workflow(_default_agents(), stores, threshold=0.55)
        wf_b.run("AAPL", data=AAPL_DATA)

        decisions_file = tmp / "decisions" / "history.jsonl"
        lines = [l for l in decisions_file.read_text().splitlines() if l.strip()]
        assert len(lines) == 2
