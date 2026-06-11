from pathlib import Path
from typing import Any

import anthropic
from pydantic import BaseModel, Field

from agents.base import AgentContext, AgentOutput, BaseAgent

_SYSTEM_PROMPT = (Path(__file__).parent.parent / "bear.md").read_text()

_VOTE_TO_SIGNAL: dict[int, str] = {
    1: "avoid",
    2: "avoid",
    3: "sell",
    4: "reduce",
    5: "hold",
    6: "buy",
    7: "buy",
}


class _FailureMode(BaseModel):
    mode: str
    estimated_downside: str  # e.g. "-38% in base bear case"


class _BearAnalysis(BaseModel):
    analysis: str
    failure_modes: list[_FailureMode] = Field(min_length=3, max_length=3)
    vote: int = Field(ge=1, le=7)
    confidence: int = Field(ge=0, le=100)


class BearAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("bear")
        self._client = anthropic.Anthropic()

    def name(self) -> str:
        return "Victoria Preservation (Bear)"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        response = self._client.messages.parse(
            model="claude-opus-4-8",
            max_tokens=4096,
            thinking={"type": "adaptive"},
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": self._build_prompt(ctx)}],
            output_format=_BearAnalysis,
        )

        result: _BearAnalysis = response.parsed_output

        return AgentOutput(
            agent_id=self.agent_id,
            signal=_VOTE_TO_SIGNAL[result.vote],
            conviction=result.confidence / 100,
            rationale=result.analysis,
            metadata={
                "vote": result.vote,
                "confidence": result.confidence,
                "failure_modes": [
                    {"mode": fm.mode, "estimated_downside": fm.estimated_downside}
                    for fm in result.failure_modes
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
            formatted = self._format_data(ctx.data)
            parts.append(f"\nFinancial data:\n{formatted}")
        if ctx.prior_decisions:
            parts.append(f"\nPrior committee decisions:\n{ctx.prior_decisions}")
        return "\n".join(parts)

    @staticmethod
    def _format_data(data: dict[str, Any]) -> str:
        lines = []
        for key, value in data.items():
            lines.append(f"  {key}: {value}")
        return "\n".join(lines)
