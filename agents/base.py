from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentContext:
    ticker: str
    timeframe: str
    data: dict[str, Any] = field(default_factory=dict)
    prior_decisions: list[dict] = field(default_factory=list)
    data_limited: bool = False                           # set by DataFetcher when quality checks fire
    data_warnings: list[str] = field(default_factory=list)  # human-readable validation messages


@dataclass
class AgentOutput:
    agent_id: str
    signal: str       # "buy" | "sell" | "hold" | "reduce" | "avoid"
    conviction: float  # 0.0–1.0
    rationale: str
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseAgent(ABC):
    def __init__(self, agent_id: str):
        self.agent_id = agent_id

    @abstractmethod
    def name(self) -> str:
        ...

    @abstractmethod
    def analyze(self, ctx: AgentContext) -> AgentOutput:
        """Round 1: independent analysis with no knowledge of other agents' views."""
        ...

    def deliberate(self, ctx: AgentContext, round1_outputs: list[AgentOutput]) -> AgentOutput:
        """Round 2: respond to the full Round 1 outputs, explicitly engaging an opposing view.

        Default falls back to analyze() so existing stubs keep working.
        Real and mock agents should override this with round-aware logic.
        """
        return self.analyze(ctx)

    def final_vote(self, ctx: AgentContext, prior_outputs: list[AgentOutput]) -> AgentOutput:
        """Round 3: signal and conviction only — no new analysis.

        Default falls back to analyze(). Override to return a lightweight output
        that carries only the final signal and conviction without re-running analysis.
        """
        return self.analyze(ctx)
