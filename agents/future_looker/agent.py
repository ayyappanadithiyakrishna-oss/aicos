from pathlib import Path
from typing import Any

import anthropic
from pydantic import BaseModel, Field

from agents.base import AgentContext, AgentOutput, BaseAgent

_SYSTEM_PROMPT = (Path(__file__).parent.parent / "future_looker.md").read_text()

_VOTE_TO_SIGNAL: dict[int, str] = {
    1: "avoid",
    2: "sell",
    3: "reduce",
    4: "hold",
    5: "buy",
    6: "buy",
    7: "buy",
}


class _FutureLookerAnalysis(BaseModel):
    analysis: str
    secular_tailwinds: list[str] = Field(min_length=2, max_length=3)
    secular_headwinds: list[str] = Field(min_length=2, max_length=3)
    disruption_risk: str          # most credible disruption scenario + probability + timeframe
    decade_revenue_scenario: str  # 10-year structural revenue thesis
    vote: int = Field(ge=1, le=7)
    confidence: int = Field(ge=0, le=100)


class FutureLookerAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("future_looker")
        self._client = anthropic.Anthropic()

    def name(self) -> str:
        return "Aria Horizon (Future Looker)"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        response = self._client.messages.parse(
            model="claude-opus-4-8",
            max_tokens=4096,
            thinking={"type": "adaptive"},
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": self._build_prompt(ctx)}],
            output_format=_FutureLookerAnalysis,
        )

        result: _FutureLookerAnalysis = response.parsed_output

        return AgentOutput(
            agent_id=self.agent_id,
            signal=_VOTE_TO_SIGNAL[result.vote],
            conviction=result.confidence / 100,
            rationale=result.analysis,
            metadata={
                "vote": result.vote,
                "confidence": result.confidence,
                "secular_tailwinds": result.secular_tailwinds,
                "secular_headwinds": result.secular_headwinds,
                "disruption_risk": result.disruption_risk,
                "decade_revenue_scenario": result.decade_revenue_scenario,
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
