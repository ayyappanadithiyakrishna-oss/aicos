import json
from pathlib import Path


class DecisionStore:
    def __init__(self, path: Path = Path("ledger/decisions/history.jsonl")):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(
        self,
        result,
        ledger_action: str = "",
        ledger_reasoning: str = "",
    ) -> None:
        """Append a complete CommitteeResult to the decision log.

        ledger_action    — what the workflow did: "opened" | "closed" | "passed" | "hold"
        ledger_reasoning — why (threshold comparison, dissent summary, etc.)
        """
        entry = {
            "timestamp": result.timestamp.isoformat(),
            "ticker": result.ticker,
            "signal": result.final_signal,
            "confidence": round(result.confidence, 4),
            "votes": [v.agent_id for v in result.votes],
            "dissents": [d.agent_id for d in result.dissents],
            "dissent_summary": result.dissent_summary,
            "rationale": result.rationale,
            "ledger_action": ledger_action,
            "ledger_reasoning": ledger_reasoning,
            "rounds": [
                {
                    "round": r.round_number,
                    "outputs": [
                        {
                            "agent_id": o.agent_id,
                            "signal": o.signal,
                            "conviction": round(o.conviction, 3),
                            "vote": o.metadata.get("vote"),
                            "confidence": o.metadata.get("confidence"),
                            "position_change": o.metadata.get("position_change"),
                        }
                        for o in r.outputs
                    ],
                }
                for r in result.rounds
            ],
        }
        with self.path.open("a") as f:
            f.write(json.dumps(entry) + "\n")

    def load_all(self) -> list[dict]:
        if not self.path.exists():
            return []
        with self.path.open() as f:
            return [json.loads(line) for line in f if line.strip()]
