from pathlib import Path
from typing import Any

import anthropic
from pydantic import BaseModel, Field

from agents.base import AgentContext, AgentOutput, BaseAgent

_SYSTEM_PROMPT = (Path(__file__).parent.parent / "devils_advocate.md").read_text()

_VOTE_TO_SIGNAL: dict[int, str] = {
    1: "avoid",
    2: "sell",
    3: "reduce",
    4: "hold",
    5: "buy",
    6: "buy",
    7: "buy",
}


class _WeakArgument(BaseModel):
    argument: str   # the argument as proponents would state it
    rebuttal: str   # the specific flaw or hidden assumption


class _DevilsAdvocateAnalysis(BaseModel):
    analysis: str
    dominant_position: str  # "bullish" | "bearish" | "neutral"
    weakest_arguments: list[_WeakArgument] = Field(min_length=3, max_length=3)
    fatal_flaw: str         # single most underpriced, most catastrophic weakness
    vote: int = Field(ge=1, le=7)
    confidence: int = Field(ge=0, le=100)


class DevilsAdvocateAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("devils_advocate")
        self._client = anthropic.Anthropic()

    def name(self) -> str:
        return "Devlin Sharp (Devil's Advocate)"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        response = self._client.messages.parse(
            model="claude-opus-4-8",
            max_tokens=4096,
            thinking={"type": "adaptive"},
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": self._build_prompt(ctx)}],
            output_format=_DevilsAdvocateAnalysis,
        )

        result: _DevilsAdvocateAnalysis = response.parsed_output

        return AgentOutput(
            agent_id=self.agent_id,
            signal=_VOTE_TO_SIGNAL[result.vote],
            conviction=result.confidence / 100,
            rationale=result.analysis,
            metadata={
                "vote": result.vote,
                "confidence": result.confidence,
                "dominant_position": result.dominant_position,
                "weakest_arguments": [
                    {"argument": w.argument, "rebuttal": w.rebuttal}
                    for w in result.weakest_arguments
                ],
                "fatal_flaw": result.fatal_flaw,
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
