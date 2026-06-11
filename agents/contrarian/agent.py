from pathlib import Path
from typing import Any

import anthropic
from pydantic import BaseModel, Field

from agents.base import AgentContext, AgentOutput, BaseAgent

_SYSTEM_PROMPT = (Path(__file__).parent.parent / "contrarian.md").read_text()

_VOTE_TO_SIGNAL: dict[int, str] = {
    1: "avoid",
    2: "sell",
    3: "reduce",
    4: "hold",
    5: "buy",
    6: "buy",
    7: "buy",
}


class _ChallengedAssumption(BaseModel):
    assumption: str        # what the consensus currently believes
    why_wrong: str         # why this assumption is likely mistaken
    falsifying_event: str  # specific data point that would publicly shatter it


class _ContrarianAnalysis(BaseModel):
    analysis: str
    consensus_view: str
    contrarian_thesis: str
    challenged_assumptions: list[_ChallengedAssumption] = Field(min_length=3, max_length=3)
    vote: int = Field(ge=1, le=7)
    confidence: int = Field(ge=0, le=100)


class ContrarianAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("contrarian")
        self._client = anthropic.Anthropic()

    def name(self) -> str:
        return "Cassandra Cross (Contrarian)"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        response = self._client.messages.parse(
            model="claude-opus-4-8",
            max_tokens=4096,
            thinking={"type": "adaptive"},
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": self._build_prompt(ctx)}],
            output_format=_ContrarianAnalysis,
        )

        result: _ContrarianAnalysis = response.parsed_output

        return AgentOutput(
            agent_id=self.agent_id,
            signal=_VOTE_TO_SIGNAL[result.vote],
            conviction=result.confidence / 100,
            rationale=result.analysis,
            metadata={
                "vote": result.vote,
                "confidence": result.confidence,
                "consensus_view": result.consensus_view,
                "contrarian_thesis": result.contrarian_thesis,
                "challenged_assumptions": [
                    {
                        "assumption": a.assumption,
                        "why_wrong": a.why_wrong,
                        "falsifying_event": a.falsifying_event,
                    }
                    for a in result.challenged_assumptions
                ],
            },
        )

    def _build_prompt(self, ctx: AgentContext) -> str:
        parts: list[str] = [
            f"Ticker: {ctx.ticker}",
            f"Timeframe: {ctx.timeframe}",
        ]
        if ctx.data_limited:
            bullet_lines = "\n".join(f"  - {w}" for w in ctx.data_warnings)
            parts.append(
                f"\nDATA QUALITY NOTE — This analysis is based on incomplete or "
                f"potentially stale data. Reflect these limitations in your confidence "
                f"score and explicitly note them in your written analysis:\n{bullet_lines}"
            )
        if ctx.data:
            parts.append(f"\nFinancial data:\n{self._format_data(ctx.data)}")
        if ctx.prior_decisions:
            parts.append(f"\nPrior committee decisions:\n{ctx.prior_decisions}")
        return "\n".join(parts)

    @staticmethod
    def _format_data(data: dict[str, Any]) -> str:
        return "\n".join(f"  {k}: {v}" for k, v in data.items())
