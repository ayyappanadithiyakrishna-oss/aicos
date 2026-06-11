import json
from pathlib import Path
from datetime import datetime


class DecisionStore:
    def __init__(self, path: Path = Path("ledger/decisions/history.jsonl")):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, decision) -> None:
        entry = {
            "timestamp": decision.timestamp.isoformat(),
            "ticker": decision.ticker,
            "signal": decision.final_signal,
            "confidence": decision.confidence,
            "votes": [v.agent_id for v in decision.votes],
            "dissents": [d.agent_id for d in decision.dissents],
            "rationale": decision.rationale,
        }
        with self.path.open("a") as f:
            f.write(json.dumps(entry) + "\n")

    def load_all(self) -> list[dict]:
        if not self.path.exists():
            return []
        with self.path.open() as f:
            return [json.loads(line) for line in f if line.strip()]
