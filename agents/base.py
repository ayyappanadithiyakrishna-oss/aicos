from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentContext:
    ticker: str
    timeframe: str
    data: dict[str, Any] = field(default_factory=dict)
    prior_decisions: list[dict] = field(default_factory=list)


@dataclass
class AgentOutput:
    agent_id: str
    signal: str          # "buy" | "sell" | "hold" | "reduce" | "avoid"
    conviction: float    # 0.0–1.0
    rationale: str
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseAgent(ABC):
    def __init__(self, agent_id: str):
        self.agent_id = agent_id

    @abstractmethod
    def analyze(self, ctx: AgentContext) -> AgentOutput:
        ...

    @abstractmethod
    def name(self) -> str:
        ...
