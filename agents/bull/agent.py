from pathlib import Path
from typing import Any

import anthropic
from pydantic import BaseModel, Field

from agents.base import AgentContext, AgentOutput, BaseAgent

_SYSTEM_PROMPT = (Path(__file__).parent.parent / "bull.md").read_text()

_VOTE_TO_SIGNAL: dict[int, str] = {
    1: "avoid",
    2: "sell",
    3: "reduce",
    4: "hold",
    5: "buy",
    6: "buy",
    7: "buy",
}


class _RevenueScenario(BaseModel):
    bear_case_cagr: str   # e.g. "+4% — pricing holds but volume flat"
    base_case_cagr: str   # e.g. "+12% — core market grows, share stable"
    bull_case_cagr: str   # e.g. "+22% — new segment launches at scale"
    expected_cagr: str    # probability-weighted across three cases
    key_drivers: list[str] = Field(min_length=2, max_length=4)


class _BullAnalysis(BaseModel):
    analysis: str
    competitive_moat: str
    earnings_quality: str
    revenue_scenario: _RevenueScenario
    # Required when vote == 7; must include a valuation bridge to intrinsic value.
    # Write "N/A" only when vote < 7.
    valuation_justification: str
    vote: int = Field(ge=1, le=7)
    confidence: int = Field(ge=0, le=100)


class BullAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("bull")
        self._client = anthropic.Anthropic()

    def name(self) -> str:
        return "Maximilian Growth (Bull)"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        response = self._client.messages.parse(
            model="claude-opus-4-8",
            max_tokens=4096,
            thinking={"type": "adaptive"},
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": self._build_prompt(ctx)}],
            output_format=_BullAnalysis,
        )

        result: _BullAnalysis = response.parsed_output

        return AgentOutput(
            agent_id=self.agent_id,
            signal=_VOTE_TO_SIGNAL[result.vote],
            conviction=result.confidence / 100,
            rationale=result.analysis,
            metadata={
                "vote": result.vote,
                "confidence": result.confidence,
                "competitive_moat": result.competitive_moat,
                "earnings_quality": result.earnings_quality,
                "revenue_scenario": {
                    "bear_case_cagr": result.revenue_scenario.bear_case_cagr,
                    "base_case_cagr": result.revenue_scenario.base_case_cagr,
                    "bull_case_cagr": result.revenue_scenario.bull_case_cagr,
                    "expected_cagr": result.revenue_scenario.expected_cagr,
                    "key_drivers": result.revenue_scenario.key_drivers,
                },
                "valuation_justification": result.valuation_justification,
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
