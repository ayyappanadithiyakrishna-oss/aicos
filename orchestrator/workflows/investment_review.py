from agents.base import AgentContext
from orchestrator.committee.session import CommitteeDecision, CommitteeSession
from ledger.decisions.store import DecisionStore


class InvestmentReviewWorkflow:
    def __init__(self, session: CommitteeSession, store: DecisionStore):
        self.session = session
        self.store = store

    def run(self, ticker: str, timeframe: str = "1d", data: dict | None = None) -> CommitteeDecision:
        ctx = AgentContext(ticker=ticker, timeframe=timeframe, data=data or {})
        decision = self.session.convene(ctx)
        self.store.record(decision)
        return decision
