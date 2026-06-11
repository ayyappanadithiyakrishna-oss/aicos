from dataclasses import dataclass, field
from datetime import datetime
from agents.base import AgentContext, AgentOutput


@dataclass
class CommitteeDecision:
    ticker: str
    final_signal: str
    confidence: float
    votes: list[AgentOutput] = field(default_factory=list)
    dissents: list[AgentOutput] = field(default_factory=list)
    rationale: str = ""
    timestamp: datetime = field(default_factory=datetime.utcnow)


class CommitteeSession:
    def __init__(self, agents: list):
        self.agents = agents

    def convene(self, ctx: AgentContext) -> CommitteeDecision:
        outputs: list[AgentOutput] = [agent.analyze(ctx) for agent in self.agents]
        return self._deliberate(ctx.ticker, outputs)

    def _deliberate(self, ticker: str, outputs: list[AgentOutput]) -> CommitteeDecision:
        # Simple weighted majority vote; replace with LLM-moderated deliberation
        signal_scores: dict[str, float] = {}
        for o in outputs:
            signal_scores[o.signal] = signal_scores.get(o.signal, 0) + o.conviction

        final_signal = max(signal_scores, key=signal_scores.__getitem__)
        total = sum(signal_scores.values())
        confidence = signal_scores[final_signal] / total if total else 0.0

        votes = [o for o in outputs if o.signal == final_signal]
        dissents = [o for o in outputs if o.signal != final_signal]

        return CommitteeDecision(
            ticker=ticker,
            final_signal=final_signal,
            confidence=confidence,
            votes=votes,
            dissents=dissents,
        )
