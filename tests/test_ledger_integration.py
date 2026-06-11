"""
Ledger integration test — three scenarios, mock agents, no API calls.

Scenario A: AAPL with default 65% threshold → confidence 57.7% → PASS
Scenario B: AAPL with threshold lowered to 55% → confidence 57.7% → OPENS position
Scenario C: AAPL REDUCE signal above threshold → CLOSES the position opened in B

Writes to an isolated temp ledger so the production ledger is unaffected.
Prints each ledger file's content after all scenarios complete.

Usage:
    python3 tests/test_ledger_integration.py   (from /Users/preeya/aicos)
"""

import json
import sys
import tempfile
import textwrap
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import CommitteeConfig, Settings
from ledger.decisions.store import DecisionStore
from ledger.positions.store import PositionStore
from ledger.transactions.store import TransactionStore
from orchestrator.committee.session import CommitteeSession
from orchestrator.workflows.investment_review import InvestmentReviewWorkflow, WorkflowResult
from tests.mocks.agents import (
    MockBearAgent,
    MockBullAgent,
    MockContrarianAgent,
    MockDevilsAdvocateAgent,
    MockFutureLookerAgent,
)

W = 74

# ---------------------------------------------------------------------------
# A reduce-dominant mock: all five agents vote REDUCE with high conviction
# so scenario C has something above threshold to close.
# ---------------------------------------------------------------------------

from agents.base import AgentContext, AgentOutput, BaseAgent


class MockReduceAgent(BaseAgent):
    """Minimal agent that always returns REDUCE at 90% conviction."""

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


def _build_stores(tmp: Path) -> tuple[DecisionStore, PositionStore, TransactionStore]:
    return (
        DecisionStore(tmp / "decisions" / "history.jsonl"),
        PositionStore(tmp / "positions" / "positions.json"),
        TransactionStore(tmp / "transactions" / "transactions.jsonl"),
    )


def _build_workflow(
    agents: list,
    stores: tuple,
    threshold: float,
) -> InvestmentReviewWorkflow:
    session = CommitteeSession(agents=agents)
    decision_store, position_store, transaction_store = stores
    settings = Settings(
        committee=CommitteeConfig(conviction_threshold=threshold)
    )
    return InvestmentReviewWorkflow(
        session=session,
        decision_store=decision_store,
        position_store=position_store,
        transaction_store=transaction_store,
        settings=settings,
    )


AAPL_DATA = {
    "price": 295.63,
    "market_cap_bn": 4342.0,
    "pe_ratio_trailing": 35.83,
    "revenue_ttm_bn": 391.0,
    "free_cash_flow_bn": 101.1,
}


# ---------------------------------------------------------------------------
# Printing helpers
# ---------------------------------------------------------------------------

def banner(title: str) -> None:
    print(f"\n{'═' * W}")
    print(f"  {title}")
    print(f"{'═' * W}")


def section(title: str) -> None:
    print(f"\n  {'─' * (W - 2)}")
    print(f"  {title}")
    print(f"  {'─' * (W - 2)}")


def print_workflow_result(label: str, wr: WorkflowResult) -> None:
    r = wr.committee_result
    action_icons = {
        "opened": "🟢 OPENED",
        "closed": "🔴 CLOSED",
        "passed": "⚪ PASSED",
        "hold":   "🟡 HOLD",
    }
    icon = action_icons.get(wr.ledger_action, wr.ledger_action.upper())
    print(f"\n  [{label}]")
    print(f"  Signal:     {r.final_signal.upper()}  |  Confidence: {r.confidence:.1%}")
    print(f"  Action:     {icon}")
    for line in textwrap.wrap(wr.ledger_reasoning, width=W - 14):
        print(f"              {line}")
    if wr.transaction:
        tx = wr.transaction
        print(f"  Transaction: {tx.id}")
        print(f"               {tx.action.upper()} {tx.shares} share(s) @ ${tx.price:.2f}")
        for line in textwrap.wrap(tx.notes, width=W - 15):
            print(f"               {line}")
    if wr.position:
        p = wr.position
        print(f"  Position:   {p.ticker} | status={p.status} | "
              f"shares={p.shares} | avg_cost=${p.avg_cost:.2f}")
        if p.closed_at:
            print(f"              closed_at={p.closed_at}")


def print_ledger_files(tmp: Path) -> None:
    section("Ledger Files Written")

    decisions_file = tmp / "decisions" / "history.jsonl"
    positions_file = tmp / "positions" / "positions.json"
    transactions_file = tmp / "transactions" / "transactions.jsonl"

    # Decisions
    print(f"\n  decisions/history.jsonl  ({decisions_file})")
    if decisions_file.exists():
        for i, line in enumerate(decisions_file.read_text().splitlines(), 1):
            entry = json.loads(line)
            print(f"  [{i}] ticker={entry['ticker']}  signal={entry['signal']}  "
                  f"confidence={entry['confidence']:.4f}  action={entry['ledger_action']}")
            for wline in textwrap.wrap(entry['ledger_reasoning'], width=W - 8):
                print(f"      {wline}")
            print(f"      rounds={len(entry.get('rounds', []))}  "
                  f"votes={entry['votes']}  dissents={entry['dissents']}")
    else:
        print("  (empty)")

    # Positions
    print(f"\n  positions/positions.json")
    if positions_file.exists():
        data = json.loads(positions_file.read_text())
        if data:
            for ticker, pos in data.items():
                print(f"  {ticker}: status={pos['status']}  shares={pos['shares']}  "
                      f"avg_cost=${pos['avg_cost']:.2f}  opened={pos['opened_at'][:19]}")
                if pos.get("closed_at"):
                    print(f"           closed={pos['closed_at'][:19]}")
        else:
            print("  (empty — no positions were opened or all were closed)")
    else:
        print("  (no file written)")

    # Transactions
    print(f"\n  transactions/transactions.jsonl")
    if transactions_file.exists():
        lines = [l for l in transactions_file.read_text().splitlines() if l.strip()]
        if lines:
            for line in lines:
                tx = json.loads(line)
                print(f"  id={tx['id']}")
                print(f"  {tx['action'].upper()} {tx['shares']} share(s) of {tx['ticker']} "
                      f"@ ${tx['price']:.2f}  ts={tx['timestamp'][:19]}")
                for nline in textwrap.wrap(tx['notes'], width=W - 4):
                    print(f"  {nline}")
                print()
        else:
            print("  (empty)")
    else:
        print("  (no file written)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    with tempfile.TemporaryDirectory(prefix="aicos_ledger_test_") as tmpdir:
        tmp = Path(tmpdir)
        stores = _build_stores(tmp)

        banner("AICOS — Ledger Integration Test  |  3 Scenarios  |  MOCK mode")

        # ── Scenario A: Default threshold (65%) — expect PASS ───────────────
        section("Scenario A — Default 65% threshold (expect PASS)")
        print("  Mock committee confidence will be ~57.7% — below threshold.")

        wf_a = _build_workflow(
            agents=[
                MockBearAgent(), MockBullAgent(), MockContrarianAgent(),
                MockDevilsAdvocateAgent(), MockFutureLookerAgent(),
            ],
            stores=stores,
            threshold=0.65,
        )
        result_a = wf_a.run("AAPL", data=AAPL_DATA)
        print_workflow_result("A", result_a)

        # ── Scenario B: Lower threshold (55%) — expect OPENED ───────────────
        section("Scenario B — Threshold lowered to 55% (expect OPENED)")
        print("  Same mock committee at 57.7% confidence — now above 55% threshold.")

        wf_b = _build_workflow(
            agents=[
                MockBearAgent(), MockBullAgent(), MockContrarianAgent(),
                MockDevilsAdvocateAgent(), MockFutureLookerAgent(),
            ],
            stores=stores,
            threshold=0.55,
        )
        result_b = wf_b.run("AAPL", data=AAPL_DATA)
        print_workflow_result("B", result_b)

        # ── Scenario C: REDUCE signal above threshold — expect CLOSED ────────
        section("Scenario C — REDUCE signal above 55% threshold (expect CLOSED)")
        print("  Five MockReduceAgents vote REDUCE at 90% conviction each.")
        print("  Existing AAPL position from Scenario B should be closed.")

        wf_c = _build_workflow(
            agents=[MockReduceAgent(f"agent_{i}") for i in range(1, 6)],
            stores=stores,
            threshold=0.55,
        )
        # Use a higher price to show positive P&L on close
        close_data = {**AAPL_DATA, "price": 312.50}
        result_c = wf_c.run("AAPL", data=close_data)
        print_workflow_result("C", result_c)

        # ── Ledger dump ──────────────────────────────────────────────────────
        print_ledger_files(tmp)

    banner("All scenarios complete. Temp ledger cleaned up.")


if __name__ == "__main__":
    main()
