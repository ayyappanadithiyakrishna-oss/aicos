from dataclasses import dataclass, field
from datetime import datetime

from agents.base import AgentContext, AgentOutput, BaseAgent


@dataclass
class DebateRound:
    round_number: int
    outputs: list[AgentOutput]


@dataclass
class CommitteeResult:
    ticker: str
    final_signal: str
    confidence: float          # fraction of conviction-weight held by the majority signal
    votes: list[AgentOutput]   # Round 3 outputs in the majority coalition
    dissents: list[AgentOutput]  # Round 3 outputs outside the majority
    dissent_summary: str
    rationale: str             # synthesized from majority agents' Round 1 analyses
    rounds: list[DebateRound]  # full 3-round transcript
    timestamp: datetime = field(default_factory=datetime.utcnow)


# Backward-compat alias so existing imports of CommitteeDecision keep working.
CommitteeDecision = CommitteeResult


class CommitteeSession:
    def __init__(self, agents: list[BaseAgent]):
        self.agents = agents

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def convene(self, ctx: AgentContext) -> CommitteeResult:
        """Run the three-round debate and return a fully populated CommitteeResult."""
        r1 = DebateRound(1, [a.analyze(ctx) for a in self.agents])
        r2 = DebateRound(2, [a.deliberate(ctx, r1.outputs) for a in self.agents])
        r3 = DebateRound(3, [a.final_vote(ctx, r1.outputs + r2.outputs) for a in self.agents])
        return self._build_result(ctx.ticker, [r1, r2, r3])

    # ------------------------------------------------------------------
    # Result construction
    # ------------------------------------------------------------------

    def _build_result(self, ticker: str, rounds: list[DebateRound]) -> CommitteeResult:
        r3_outputs = rounds[2].outputs

        # Conviction-weighted majority: each agent's Round 3 conviction counts toward their signal.
        signal_scores: dict[str, float] = {}
        for o in r3_outputs:
            signal_scores[o.signal] = signal_scores.get(o.signal, 0.0) + o.conviction

        final_signal = max(signal_scores, key=signal_scores.__getitem__)
        total = sum(signal_scores.values())
        confidence = signal_scores[final_signal] / total if total else 0.0

        votes = [o for o in r3_outputs if o.signal == final_signal]
        dissents = [o for o in r3_outputs if o.signal != final_signal]

        return CommitteeResult(
            ticker=ticker,
            final_signal=final_signal,
            confidence=confidence,
            votes=votes,
            dissents=dissents,
            dissent_summary=self._dissent_summary(dissents, rounds),
            rationale=self._majority_rationale(votes, rounds),
            rounds=rounds,
        )

    def _dissent_summary(
        self, dissents: list[AgentOutput], rounds: list[DebateRound]
    ) -> str:
        if not dissents:
            return "Unanimous committee decision."

        r1_index = {o.agent_id: o for o in rounds[0].outputs}
        r2_index = {o.agent_id: o for o in rounds[1].outputs}

        parts: list[str] = []
        for d in dissents:
            r1 = r1_index.get(d.agent_id)
            r2 = r2_index.get(d.agent_id)
            # Prefer Round 2 opposing_reference if present; else fall back to Round 1 snippet.
            ref = r2.metadata.get("opposing_reference", "") if r2 else ""
            snippet = ref if ref else (r1.rationale[:200].rstrip() + "…" if r1 else "")
            name = d.metadata.get("agent_name", d.agent_id.replace("_", " ").title())
            parts.append(
                f"{name} — {d.signal.upper()} ({d.conviction:.0%} conviction). {snippet}"
            )
        return "\n\n".join(parts)

    def _majority_rationale(
        self, votes: list[AgentOutput], rounds: list[DebateRound]
    ) -> str:
        r1_index = {o.agent_id: o for o in rounds[0].outputs}
        snippets: list[str] = []
        for v in votes:
            r1 = r1_index.get(v.agent_id)
            if r1:
                snippets.append(f"[{v.agent_id}] {r1.rationale[:220].rstrip()}…")
        return "\n".join(snippets)
